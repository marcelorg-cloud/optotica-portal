import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";
import { buildArtifactOutputs } from "../../../../../lib/artifact-outputs";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "no-store" };
const MAX_ROWS = 1000;

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status, headers: HEADERS });
  const { taskId } = await params;
  const supabase = await createServerSupabaseClient();
  const task = await supabase.from("regent_tasks").select("id,title,status,engine_version")
    .eq("id", taskId).eq("user_id", auth.userId).maybeSingle();
  if (task.error || !task.data) return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: task.error ? 500 : 404, headers: HEADERS });
  const [steps, runs, reviews] = await Promise.all([
    supabase.from("regent_task_steps").select("step_number,role,node_ids,status,artifact,revision,validated_at,completed_at,updated_at")
      .eq("task_id", taskId).eq("user_id", auth.userId).order("step_number").limit(MAX_ROWS),
    // Failed/running runs can contain confirmed partial external effects; never conceal them.
    supabase.from("regent_tool_runs").select("id,step_number,node_id,adapter,status,input,output,created_at,updated_at")
      .eq("task_id", taskId).eq("user_id", auth.userId).not("output", "is", null)
      .order("created_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("regent_phase_reviews").select("id,step_number,revision,decision,output,created_at")
      .eq("task_id", taskId).eq("user_id", auth.userId).eq("decision", "superseded")
      .order("created_at", { ascending: false }).limit(MAX_ROWS),
  ]);
  if (steps.error || runs.error || reviews.error) return NextResponse.json({ error: "outputs_failed", message: "Não foi possível ler os outputs preservados. Nenhum arquivo foi alterado." }, { status: 500, headers: HEADERS });
  const outputs = buildArtifactOutputs({ taskId, steps: steps.data || [], runs: runs.data || [], reviews: reviews.data || [] });
  const download = new URL(request.url).searchParams.get("download");
  if (download) {
    const item = outputs.find((output) => output.id === download);
    if (!item) return NextResponse.json({ error: "output_not_found" }, { status: 404, headers: HEADERS });
    return new Response("# " + task.data.title + "\n\nEtapa " + item.step + " · revisão " + item.revision + " · " + item.source + " · estado " + item.status + "\n\n" + item.fullContent, {
      headers: { ...HEADERS, "Content-Type": "text/markdown; charset=utf-8", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'attachment; filename="' + item.filename + '"' },
    });
  }
  return NextResponse.json({ task: { ...task.data,
    completedSteps: (steps.data || []).filter((step) => step.status === "succeeded").length,
    skippedSteps: (steps.data || []).filter((step) => step.status === "skipped").length,
    validatedSteps: (steps.data || []).filter((step) => step.validated_at != null).length,
    failedSteps: (steps.data || []).filter((step) => ["failed", "blocked"].includes(step.status)).length,
    totalSteps: steps.data?.length || 0, outputCount: outputs.length },
    items: outputs.map(({ fullContent: _full, ...item }) => item),
    historyLimitReached: [runs.data?.length, reviews.data?.length].some((count) => count === MAX_ROWS),
    limitations: ["Links de edição Canva não são arquivos exportados; acesso depende da conta e da permissão do design.",
      "Links em textos generativos não foram verificados como fontes."] }, { headers: HEADERS });
}
