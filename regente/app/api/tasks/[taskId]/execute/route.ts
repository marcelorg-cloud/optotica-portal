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
import {
  analyzeRecovery,
  applyRecoveryDecision,
  errorFingerprint,
  reviewRecoveryWithClaude,
  type RecoveryDecisionOutput,
} from "../../../../../lib/recovery";

export const runtime = "nodejs";
export const maxDuration = 300;

type Artifact = { step: number; node: string; output: unknown };
type Blocked = { step: number; nodes: string[]; reason: string; recovery?: unknown };

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Falha desconhecida.");
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

  const userId = userId;
  const { taskId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: task, error: taskError } = await supabase
    .from("regent_tasks")
    .select("id, session_id, title, objective, status, pipeline, picker, human_decision")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: 404 });
  }

  const taskData = task;

  if (taskData.status !== "approved") {
    return NextResponse.json(
      { error: "approval_required", message: "A tarefa precisa estar aprovada antes da execução." },
      { status: 409 },
    );
  }

  const pipeline = (Array.isArray(taskData.pipeline) ? taskData.pipeline : []) as PipelineStep[];
  const decision = taskData.human_decision as { decision?: string; approved_steps?: number[] | null } | null;
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
    .eq("user_id", userId);

  await supabase.from("regent_task_events").insert({
    task_id: taskId,
    user_id: userId,
    event_type: "execution_started",
    payload: { steps: executable.map((step) => step.step) },
  });

  const artifacts: Artifact[] = [];
  const blocked: Blocked[] = [];
  let humanEscalation = false;

  async function event(eventType: string, payload: unknown) {
    await supabase.from("regent_task_events").insert({
      task_id: taskId,
      user_id: userId,
      event_type: eventType,
      payload,
    });
  }

  async function runStep(step: PipelineStep, variantOverride?: number): Promise<Artifact | Blocked> {
    const nodes = unique(step.nodes || []);
    const primary = nodes[0] || "";

    if (isOpenAINode(primary)) {
      const { data: runRow, error: runError } = await supabase
        .from("regent_tool_runs")
        .insert({
          task_id: taskId,
          user_id: userId,
          step_number: step.step,
          node_id: primary,
          adapter: "openai_agents",
          status: "running",
          input: { step, objective: taskData.objective },
        })
        .select("id")
        .single();
      if (runError || !runRow) throw new Error("Não foi possível registrar a execução OpenAI.");

      try {
        const output = await executeOpenAIWorker({
          node: primary,
          step,
          objective: taskData.objective,
          priorArtifacts: artifacts,
        });
        await supabase
          .from("regent_tool_runs")
          .update({ status: "succeeded", output, updated_at: new Date().toISOString() })
          .eq("id", runRow.id)
          .eq("user_id", userId);
        return { step: step.step, node: primary, output };
      } catch (error) {
        await supabase
          .from("regent_tool_runs")
          .update({
            status: "failed",
            output: { message: errorMessage(error) },
            updated_at: new Date().toISOString(),
          })
          .eq("id", runRow.id)
          .eq("user_id", userId);
        throw error;
      }
    }

    if (primary === "A4") {
      const { data: runRow, error: runError } = await supabase
        .from("regent_tool_runs")
        .insert({
          task_id: taskId,
          user_id: userId,
          step_number: step.step,
          node_id: primary,
          adapter: "anthropic_messages",
          status: "running",
          input: { step, objective: taskData.objective },
        })
        .select("id")
        .single();
      if (runError || !runRow) throw new Error("Não foi possível registrar a execução Claude.");

      try {
        const output = await executeClaudeWorker({
          step,
          objective: taskData.objective,
          priorArtifacts: artifacts,
        });

        if (output.blocked) {
          await supabase
            .from("regent_tool_runs")
            .update({ status: "blocked", output, updated_at: new Date().toISOString() })
            .eq("id", runRow.id)
            .eq("user_id", userId);
          return { step: step.step, nodes, reason: output.reason || "Claude indisponível." };
        }

        await supabase
          .from("regent_tool_runs")
          .update({ status: "succeeded", output, updated_at: new Date().toISOString() })
          .eq("id", runRow.id)
          .eq("user_id", userId);
        return { step: step.step, node: primary, output };
      } catch (error) {
        await supabase
          .from("regent_tool_runs")
          .update({
            status: "failed",
            output: { message: errorMessage(error) },
            updated_at: new Date().toISOString(),
          })
          .eq("id", runRow.id)
          .eq("user_id", userId);
        throw error;
      }
    }

    if (primary === "F6") {
      const configuredVariants = Number(
        (taskData.picker as { variantsRequested?: number } | null)?.variantsRequested || 1,
      );
      const variants = Math.max(1, Math.min(3, variantOverride || configuredVariants));
      const spec = await buildCanvaSpec({
        step,
        objective: taskData.objective,
        title: taskData.title,
        priorArtifacts: artifacts,
        variants,
      });
      const output = await executeCanvaBridge({
        taskId,
        userId: userId,
        step,
        spec,
        variants,
      });
      return { step: step.step, node: primary, output };
    }

    const reason =
      primary === "F12" || primary === "F13"
        ? "Google Drive/Docs ainda precisa do OAuth próprio do Regente; a conexão do ChatGPT não é reutilizável pelo app."
        : `Adapter do nó ${primary || "desconhecido"} ainda não conectado.`;

    await supabase.from("regent_tool_runs").insert({
      task_id: taskId,
      user_id: userId,
      step_number: step.step,
      node_id: primary || "unknown",
      adapter: "unavailable",
      status: "blocked",
      input: { step },
      output: { reason },
    });
    return { step: step.step, nodes, reason };
  }

  async function escalateToHuman(
    step: PipelineStep,
    node: string,
    error: unknown,
    first: RecoveryDecisionOutput | null,
    second: RecoveryDecisionOutput | null,
    claudeReview: string | null,
  ) {
    humanEscalation = true;
    const reason = [
      `A recuperação automática não conseguiu concluir a etapa ${step.step} (${node}).`,
      `Erro: ${errorMessage(error)}`,
      second?.diagnosis || first?.diagnosis ? `Diagnóstico: ${second?.diagnosis || first?.diagnosis}` : "",
      second?.patchProposal || first?.patchProposal
        ? `Correção de código sugerida: ${second?.patchProposal || first?.patchProposal}`
        : "",
      claudeReview ? "O Claude participou da segunda análise." : "",
      "A pipeline foi pausada para validação humana.",
    ].filter(Boolean).join(" ");

    blocked.push({
      step: step.step,
      nodes: [node],
      reason,
      recovery: { first, second, claudeReview },
    });

    await event("recovery_escalated_human", {
      step: step.step,
      node,
      error: errorMessage(error),
      first,
      second,
      claudeReview,
    });
  }

  try {
    pipelineLoop:
    for (const originalStep of executable) {
      const existing = await supabase
        .from("regent_tool_runs")
        .select("id, node_id, output")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .eq("step_number", originalStep.step)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing.data) {
        artifacts.push({ step: originalStep.step, node: existing.data.node_id, output: existing.data.output });
        continue;
      }

      const primary = unique(originalStep.nodes || [])[0] || "unknown";

      try {
        const result = await runStep(originalStep);
        if ("output" in result) artifacts.push(result);
        else blocked.push(result);
        continue;
      } catch (initialError) {
        await event("recovery_started", {
          step: originalStep.step,
          node: primary,
          error: errorMessage(initialError),
          fingerprint: errorFingerprint(initialError),
        });

        let first: RecoveryDecisionOutput | null = null;
        try {
          first = await analyzeRecovery({
            objective: taskData.objective,
            taskTitle: taskData.title,
            step: originalStep,
            node: primary,
            error: initialError,
            artifacts,
            recurrence: 1,
          });
          await event("recovery_a5_analysis", {
            step: originalStep.step,
            node: primary,
            recurrence: 1,
            decision: first,
          });
        } catch (recoveryError) {
          await escalateToHuman(originalStep, primary, recoveryError, null, null, null);
          break pipelineLoop;
        }

        if (first.codeChangeRequired || !first.canRetry || first.retryStrategy === "none") {
          await escalateToHuman(originalStep, primary, initialError, first, null, null);
          break pipelineLoop;
        }

        const firstRetryStep = applyRecoveryDecision(originalStep, first);
        try {
          const recovered = await runStep(firstRetryStep, first.reduceVariantsTo || undefined);
          if ("output" in recovered) artifacts.push(recovered);
          else blocked.push(recovered);
          await event("recovery_succeeded", {
            step: originalStep.step,
            node: primary,
            level: "A5",
            decision: first,
          });
          continue;
        } catch (retryError) {
          const sameError = errorFingerprint(retryError) === errorFingerprint(initialError);
          let claudeReview: string | null = null;

          if (sameError) {
            try {
              const review = await reviewRecoveryWithClaude({
                objective: taskData.objective,
                taskTitle: taskData.title,
                step: firstRetryStep,
                node: primary,
                error: retryError,
                firstDecision: first,
              });
              claudeReview = review.review;
              await event("recovery_a4_review", {
                step: originalStep.step,
                node: primary,
                available: review.available,
                review: review.review,
              });
              if (!review.available) {
                await escalateToHuman(originalStep, primary, retryError, first, null, review.review);
                break pipelineLoop;
              }
            } catch (claudeError) {
              await event("recovery_a4_failed", {
                step: originalStep.step,
                node: primary,
                error: errorMessage(claudeError),
              });
              await escalateToHuman(originalStep, primary, retryError, first, null, null);
              break pipelineLoop;
            }
          }

          let second: RecoveryDecisionOutput | null = null;
          try {
            second = await analyzeRecovery({
              objective: taskData.objective,
              taskTitle: taskData.title,
              step: firstRetryStep,
              node: primary,
              error: retryError,
              artifacts,
              previousRecovery: first,
              claudeReview,
              recurrence: 2,
            });
            await event("recovery_a5_analysis", {
              step: originalStep.step,
              node: primary,
              recurrence: 2,
              sameError,
              decision: second,
            });
          } catch (secondRecoveryError) {
            await escalateToHuman(originalStep, primary, secondRecoveryError, first, null, claudeReview);
            break pipelineLoop;
          }

          if (second.codeChangeRequired || !second.canRetry || second.retryStrategy === "none") {
            await escalateToHuman(originalStep, primary, retryError, first, second, claudeReview);
            break pipelineLoop;
          }

          const secondRetryStep = applyRecoveryDecision(firstRetryStep, second);
          try {
            const recovered = await runStep(secondRetryStep, second.reduceVariantsTo || first.reduceVariantsTo || undefined);
            if ("output" in recovered) artifacts.push(recovered);
            else blocked.push(recovered);
            await event("recovery_succeeded", {
              step: originalStep.step,
              node: primary,
              level: sameError ? "A5+A4+A5" : "A5+A5",
              first,
              second,
              claudeReview,
            });
            continue;
          } catch (finalError) {
            await escalateToHuman(originalStep, primary, finalError, first, second, claudeReview);
            break pipelineLoop;
          }
        }
      }
    }

    const finalStatus = blocked.length ? "blocked" : "succeeded";
    await supabase
      .from("regent_tasks")
      .update({ status: finalStatus, updated_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("user_id", userId);

    await event(
      humanEscalation
        ? "execution_paused_for_human"
        : blocked.length
          ? "execution_partially_blocked"
          : "execution_succeeded",
      { artifacts, blocked },
    );

    const canvaLinks = artifacts
      .flatMap((artifact) => {
        const value = artifact.output as { designs?: Array<{ editUrl?: string; title?: string }> } | null;
        return Array.isArray(value?.designs) ? value!.designs! : [];
      })
      .filter((design) => design.editUrl)
      .map((design, index) => `${design.title || `Canva ${index + 1}`}: ${design.editUrl}`);

    const completionMessage = [
      humanEscalation
        ? "A execução foi pausada depois que o mecanismo de recuperação esgotou as tentativas seguras. É necessária validação humana."
        : blocked.length
          ? "Executei as etapas conectadas; algumas ficaram bloqueadas."
          : "Pipeline executado com sucesso.",
      canvaLinks.length ? `Designs Canva:\n${canvaLinks.join("\n")}` : "",
      blocked.length
        ? `Bloqueios / recovery:\n${blocked.map((item) => `Etapa ${item.step}: ${item.reason}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n");

    await supabase.from("regent_messages").insert({
      session_id: taskData.session_id,
      user_id: userId,
      role: "assistant",
      content: completionMessage,
    });

    return NextResponse.json({
      taskId,
      status: finalStatus,
      artifacts,
      blocked,
      recoveryEscalated: humanEscalation,
      message: completionMessage,
    });
  } catch (error) {
    const message = errorMessage(error);
    await supabase
      .from("regent_tasks")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("user_id", userId);

    await event("execution_failed", { message, artifacts, blocked });

    return NextResponse.json(
      { error: "execution_failed", message, artifacts, blocked },
      { status: 500 },
    );
  }
}
