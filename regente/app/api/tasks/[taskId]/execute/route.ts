import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";
import {
  buildCanvaSpec,
  executeCanvaBridge,
  executeClaudeWorker,
  executeOpenAIWorker,
  isOpenAINode,
  type PipelineStep,
} from "../../../../../lib/adapters";

export const runtime = "nodejs";
export const maxDuration = 120;

type Artifact = { step: number; node: string; output: unknown };

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export async function POST(
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
    .select("id, session_id, title, objective, status, pipeline, picker, human_decision")
    .eq("id", taskId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: 404 });
  }

  if (task.status !== "approved") {
    return NextResponse.json(
      { error: "approval_required", message: "A tarefa precisa estar aprovada antes da execução." },
      { status: 409 },
    );
  }

  const pipeline = (Array.isArray(task.pipeline) ? task.pipeline : []) as PipelineStep[];
  const decision = task.human_decision as { decision?: string; approved_steps?: number[] | null } | null;
  const approvedSteps =
    decision?.decision === "partial" && Array.isArray(decision.approved_steps)
      ? new Set(decision.approved_steps)
      : null;

  const executable = pipeline.filter((step) => !approvedSteps || approvedSteps.has(step.step));
  if (!executable.length) {
    return NextResponse.json(
      { error: "no_steps", message: "Nenhuma etapa aprovada para execução." },
      { status: 409 },
    );
  }

  await supabase
    .from("regent_tasks")
    .update({ status: "executing", updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", auth.userId);

  await supabase.from("regent_task_events").insert({
    task_id: taskId,
    user_id: auth.userId,
    event_type: "execution_started",
    payload: { steps: executable.map((step) => step.step) },
  });

  const artifacts: Artifact[] = [];
  const blocked: Array<{ step: number; nodes: string[]; reason: string }> = [];

  try {
    for (const step of executable) {
      const existing = await supabase
        .from("regent_tool_runs")
        .select("id, node_id, output")
        .eq("task_id", taskId)
        .eq("user_id", auth.userId)
        .eq("step_number", step.step)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing.data) {
        artifacts.push({ step: step.step, node: existing.data.node_id, output: existing.data.output });
        continue;
      }

      const nodes = unique(step.nodes || []);
      const primary = nodes[0] || "";

      if (isOpenAINode(primary)) {
        const { data: runRow, error: runError } = await supabase
          .from("regent_tool_runs")
          .insert({
            task_id: taskId,
            user_id: auth.userId,
            step_number: step.step,
            node_id: primary,
            adapter: "openai_agents",
            status: "running",
            input: { step, objective: task.objective },
          })
          .select("id")
          .single();
        if (runError || !runRow) throw new Error("Não foi possível registrar a execução OpenAI.");

        try {
          const output = await executeOpenAIWorker({
            node: primary,
            step,
            objective: task.objective,
            priorArtifacts: artifacts,
          });
          await supabase
            .from("regent_tool_runs")
            .update({ status: "succeeded", output, updated_at: new Date().toISOString() })
            .eq("id", runRow.id)
            .eq("user_id", auth.userId);
          artifacts.push({ step: step.step, node: primary, output });
        } catch (error) {
          await supabase
            .from("regent_tool_runs")
            .update({
              status: "failed",
              output: { message: error instanceof Error ? error.message : "Falha OpenAI" },
              updated_at: new Date().toISOString(),
            })
            .eq("id", runRow.id)
            .eq("user_id", auth.userId);
          throw error;
        }
        continue;
      }

      if (primary === "A4") {
        const { data: runRow, error: runError } = await supabase
          .from("regent_tool_runs")
          .insert({
            task_id: taskId,
            user_id: auth.userId,
            step_number: step.step,
            node_id: primary,
            adapter: "anthropic_messages",
            status: "running",
            input: { step, objective: task.objective },
          })
          .select("id")
          .single();
        if (runError || !runRow) throw new Error("Não foi possível registrar a execução Claude.");

        const output = await executeClaudeWorker({
          step,
          objective: task.objective,
          priorArtifacts: artifacts,
        });

        if (output.blocked) {
          await supabase
            .from("regent_tool_runs")
            .update({ status: "blocked", output, updated_at: new Date().toISOString() })
            .eq("id", runRow.id)
            .eq("user_id", auth.userId);
          blocked.push({ step: step.step, nodes, reason: output.reason });
          continue;
        }

        await supabase
          .from("regent_tool_runs")
          .update({ status: "succeeded", output, updated_at: new Date().toISOString() })
          .eq("id", runRow.id)
          .eq("user_id", auth.userId);
        artifacts.push({ step: step.step, node: primary, output });
        continue;
      }

      if (primary === "F6") {
        const variants = Math.max(
          1,
          Math.min(3, Number((task.picker as { variantsRequested?: number } | null)?.variantsRequested || 1)),
        );
        const spec = await buildCanvaSpec({
          step,
          objective: task.objective,
          title: task.title,
          priorArtifacts: artifacts,
          variants,
        });
        const output = await executeCanvaBridge({
          taskId,
          userId: auth.userId,
          step,
          spec,
          variants,
        });
        artifacts.push({ step: step.step, node: primary, output });
        continue;
      }

      const reason =
        primary === "F12" || primary === "F13"
          ? "Google Drive/Docs ainda precisa do OAuth próprio do Regente; a conexão do ChatGPT não é reutilizável pelo app."
          : `Adapter do nó ${primary || "desconhecido"} ainda não conectado.`;

      await supabase.from("regent_tool_runs").insert({
        task_id: taskId,
        user_id: auth.userId,
        step_number: step.step,
        node_id: primary || "unknown",
        adapter: "unavailable",
        status: "blocked",
        input: { step },
        output: { reason },
      });
      blocked.push({ step: step.step, nodes, reason });
    }

    const finalStatus = blocked.length ? "blocked" : "succeeded";
    await supabase
      .from("regent_tasks")
      .update({ status: finalStatus, updated_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("user_id", auth.userId);

    await supabase.from("regent_task_events").insert({
      task_id: taskId,
      user_id: auth.userId,
      event_type: blocked.length ? "execution_partially_blocked" : "execution_succeeded",
      payload: { artifacts, blocked },
    });

    const canvaLinks = artifacts
      .flatMap((artifact) => {
        const value = artifact.output as { designs?: Array<{ editUrl?: string; title?: string }> } | null;
        return Array.isArray(value?.designs) ? value!.designs! : [];
      })
      .filter((design) => design.editUrl)
      .map((design, index) => `${design.title || `Canva ${index + 1}`}: ${design.editUrl}`);

    const completionMessage = [
      blocked.length
        ? "Executei as etapas conectadas; algumas ficaram bloqueadas."
        : "Pipeline executado com sucesso.",
      canvaLinks.length ? `Designs Canva:\n${canvaLinks.join("\n")}` : "",
      blocked.length ? `Bloqueios:\n${blocked.map((item) => `Etapa ${item.step}: ${item.reason}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    await supabase.from("regent_messages").insert({
      session_id: task.session_id,
      user_id: auth.userId,
      role: "assistant",
      content: completionMessage,
    });

    return NextResponse.json({
      taskId,
      status: finalStatus,
      artifacts,
      blocked,
      message: blocked.length
        ? "As etapas conectadas foram executadas; algumas ficaram bloqueadas por falta de adapter/configuração."
        : "Pipeline executado com sucesso.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha durante a execução.";
    await supabase
      .from("regent_tasks")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("user_id", auth.userId);

    await supabase.from("regent_task_events").insert({
      task_id: taskId,
      user_id: auth.userId,
      event_type: "execution_failed",
      payload: { message, artifacts, blocked },
    });

    return NextResponse.json({ error: "execution_failed", message, artifacts, blocked }, { status: 500 });
  }
}
