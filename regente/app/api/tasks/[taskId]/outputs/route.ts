import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";

export const runtime = "nodejs";

const MAX_OUTPUT_CHARS = 24_000;
const MAX_ITEMS = 100;

function outputText(value: unknown) {
  const text = typeof value === "string"
    ? value
    : JSON.stringify(value, null, 2) || "";
  return text.length <= MAX_OUTPUT_CHARS
    ? text
    : text.slice(0, MAX_OUTPUT_CHARS) + "\n… [conteúdo truncado na visualização]";
}

function outputLinks(value: unknown): string[] {
  const seen = new Set<string>();
  const visit = (item: unknown, depth = 0) => {
    if (depth > 6 || seen.size >= 25) return;
    if (typeof item === "string") {
      for (const match of item.matchAll(/https?:\/\/[^\s\"'<>]+/g)) {
        const url = match[0].replace(/[.,;)\]]+$/, "");
        try {
          const parsed = new URL(url);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") seen.add(parsed.href);
        } catch { /* Ignore invalid URL */ }
      }
    } else if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, depth + 1));
    } else if (item && typeof item === "object") {
      Object.values(item).forEach((entry) => visit(entry, depth + 1));
    }
  };
  visit(value);
  return [...seen];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireMaster();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.message },
      { status: auth.status },
    );
  }

  const { taskId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: task, error: taskError } = await supabase
    .from("regent_tasks")
    .select("id,title,status")
    .eq("id", taskId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (taskError || !task) {
    return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: 404 });
  }

  const [{ data: steps, error: stepsError }, { data: runs, error: runsError }] = await Promise.all([
    supabase
      .from("regent_task_steps")
      .select("step_number,role,node_ids,status,artifact,completed_at,updated_at")
      .eq("task_id", taskId)
      .eq("user_id", auth.userId)
      .order("step_number", { ascending: true })
      .limit(MAX_ITEMS),
    supabase
      .from("regent_tool_runs")
      .select("id,step_number,node_id,adapter,status,output,created_at,updated_at")
      .eq("task_id", taskId)
      .eq("user_id", auth.userId)
      .in("status", ["succeeded"])
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS),
  ]);

  if (stepsError || runsError) {
    return NextResponse.json({ error: "outputs_failed", message: "Não foi possível listar os outputs." }, { status: 500 });
  }

  const items = [
    ...(runs || []).filter((run) => run.output !== null).map((run) => ({
      id: `run-${run.id}`,
      step: run.step_number,
      node: run.node_id || "—",
      kind: run.adapter || "execução",
      source: "execução",
      status: run.status,
      createdAt: run.updated_at || run.created_at,
      content: outputText(run.output),
      links: outputLinks(run.output),
    })),
    ...(steps || []).filter((step) => step.artifact !== null).map((step) => ({
      id: `step-${step.step_number}`,
      step: step.step_number,
      node: (step.node_ids || []).join(", ") || "—",
      kind: step.role || "etapa",
      source: "checkpoint",
      status: step.status,
      createdAt: step.completed_at || step.updated_at,
      content: outputText(step.artifact),
      links: outputLinks(step.artifact),
    })),
  ].sort((a, b) => a.step - b.step || a.source.localeCompare(b.source));

  return NextResponse.json(
    { task: { id: task.id, title: task.title, status: task.status }, items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
