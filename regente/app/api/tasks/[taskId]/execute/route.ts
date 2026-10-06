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
import { markTaskStep, syncTaskProgress } from "../../../../../lib/task-state";

export const runtime = "nodejs";
export const maxDuration = 300;
const configuredRecoveryAttempts = Number(process.env.REGENT_RECOVERY_MAX_ATTEMPTS || 3);
const RECOVERY_MAX_ATTEMPTS = Number.isFinite(configuredRecoveryAttempts)
  ? Math.max(1, Math.min(3, Math.trunc(configuredRecoveryAttempts)))
  : 3;

type Artifact = { step: number; node: string; output: unknown };
type Blocked = { step: number; nodes: string[]; reason: string; recovery?: unknown };
type RecoveryAttempt = {
  attempt: number;
  errorBefore: string;
  decision?: RecoveryDecisionOutput | null;
  claudeReview?: string | null;
  outcome: "analysis_failed" | "analysis_only" | "retry_failed" | "retry_blocked" | "succeeded";
  errorAfter?: string;
};

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

  const userId = auth.userId;
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
    attempts: RecoveryAttempt[],
  ) {
    humanEscalation = true;
    const lastDecision = [...attempts].reverse().find((item) => item.decision)?.decision || null;
    const claudeParticipated = attempts.some((item) => Boolean(item.claudeReview));
    await markTaskStep({
      supabase, taskId, userId, stepNumber: step.step,
      status: "failed", error,
      nextAction: "As 3 tentativas progressivas de autocorreção foram esgotadas. Validação humana necessária.",
    });
    await syncTaskProgress({ supabase, taskId, userId });
    const reason = [
      `A recuperação automática esgotou ${RECOVERY_MAX_ATTEMPTS} tentativas na etapa ${step.step} (${node}).`,
      `Último erro: ${errorMessage(error)}`,
      lastDecision?.diagnosis ? `Diagnóstico final: ${lastDecision.diagnosis}` : "",
      lastDecision?.patchProposal ? `Correção de código sugerida: ${lastDecision.patchProposal}` : "",
      claudeParticipated ? "ChatGPT e Claude participaram da análise cruzada antes do escalonamento." : "",
      "A pipeline foi pausada somente após o protocolo de autorrecuperação ser esgotado.",
    ].filter(Boolean).join(" ");

    blocked.push({
      step: step.step,
      nodes: [node],
      reason,
      recovery: { maxAttempts: RECOVERY_MAX_ATTEMPTS, attempts },
    });

    await event("recovery_escalated_human", {
      step: step.step,
      node,
      error: errorMessage(error),
      maxAttempts: RECOVERY_MAX_ATTEMPTS,
      attempts,
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
        await markTaskStep({
          supabase, taskId, userId, stepNumber: originalStep.step,
          status: "succeeded", artifact: existing.data.output,
          nextAction: "Resultado confirmado e reaproveitado; seguir para a próxima etapa.",
        });
        await syncTaskProgress({ supabase, taskId, userId });
        continue;
      }

      let preExecutionError: Error | null = null;
      const stepState = await supabase
        .from("regent_task_steps")
        .select("depends_on")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .eq("step_number", originalStep.step)
        .maybeSingle();
      const dependencies = (stepState.data?.depends_on || []) as number[];
      if (dependencies.length) {
        const dependencyRows = await supabase
          .from("regent_task_steps")
          .select("step_number,status")
          .eq("task_id", taskId)
          .eq("user_id", userId)
          .in("step_number", dependencies);
        const unresolved = dependencies.filter((dep) =>
          !dependencyRows.data?.some((row) => row.step_number === dep && row.status === "succeeded")
        );
        if (unresolved.length) {
          const reason = `Dependências pendentes: etapas ${unresolved.join(", ")}.`;
          preExecutionError = new Error(reason);
          await event("recovery_dependency_blocked", {
            step: originalStep.step,
            unresolved,
            reason,
          });
          await markTaskStep({
            supabase, taskId, userId, stepNumber: originalStep.step,
            status: "review",
            error: preExecutionError,
            nextAction: "O protocolo de autorrecuperação vai tentar resolver o impedimento antes de solicitar intervenção humana.",
          });
          await syncTaskProgress({ supabase, taskId, userId });
        }
      }

      const primary = unique(originalStep.nodes || [])[0] || "unknown";
      await markTaskStep({
        supabase, taskId, userId, stepNumber: originalStep.step,
        status: "running", incrementAttempt: true,
        nextAction: `Executando etapa ${originalStep.step} em ${primary}.`,
      });
      await syncTaskProgress({ supabase, taskId, userId });

      let currentError: unknown = preExecutionError;
      let workingStep = originalStep;

      if (!currentError) {
        try {
          const result = await runStep(workingStep);
          if ("output" in result) {
            artifacts.push(result);
            await markTaskStep({
              supabase, taskId, userId, stepNumber: originalStep.step,
              status: "succeeded", artifact: result.output,
              nextAction: "Etapa concluída; seguir para a próxima dependência liberada.",
            });
            await syncTaskProgress({ supabase, taskId, userId });
            continue;
          }
          currentError = new Error(result.reason);
          await event("recovery_block_detected", {
            step: originalStep.step,
            node: primary,
            reason: result.reason,
          });
        } catch (error) {
          currentError = error;
        }
      }

      await markTaskStep({
        supabase, taskId, userId, stepNumber: originalStep.step,
        status: "review", error: currentError,
        nextAction: `Autocorreção iniciada: até ${RECOVERY_MAX_ATTEMPTS} tentativas progressivas antes de escalar ao humano.`,
      });
      await syncTaskProgress({ supabase, taskId, userId });
      await event("recovery_started", {
        step: originalStep.step,
        node: primary,
        error: errorMessage(currentError),
        fingerprint: errorFingerprint(currentError),
        maxAttempts: RECOVERY_MAX_ATTEMPTS,
      });

      const attempts: RecoveryAttempt[] = [];
      let previousDecision: RecoveryDecisionOutput | null = null;
      let recovered = false;

      for (let attempt = 1; attempt <= RECOVERY_MAX_ATTEMPTS; attempt += 1) {
        const errorBefore = errorMessage(currentError);
        let claudeReview: string | null = null;

        if (attempt >= 2 && previousDecision) {
          try {
            const review = await reviewRecoveryWithClaude({
              objective: taskData.objective,
              taskTitle: taskData.title,
              step: workingStep,
              node: primary,
              error: currentError,
              firstDecision: previousDecision,
            });
            claudeReview = review.review;
            await event("recovery_a4_review", {
              step: originalStep.step,
              node: primary,
              attempt,
              available: review.available,
              review: review.review,
            });
          } catch (claudeError) {
            claudeReview = `Claude indisponível nesta tentativa: ${errorMessage(claudeError)}`;
            await event("recovery_a4_failed", {
              step: originalStep.step,
              node: primary,
              attempt,
              error: errorMessage(claudeError),
            });
          }
        }

        let decision: RecoveryDecisionOutput | null = null;
        try {
          decision = await analyzeRecovery({
            objective: taskData.objective,
            taskTitle: taskData.title,
            step: workingStep,
            node: primary,
            error: currentError,
            artifacts,
            previousRecovery: previousDecision,
            claudeReview,
            recurrence: attempt,
          });
          await event("recovery_a5_analysis", {
            step: originalStep.step,
            node: primary,
            recurrence: attempt,
            decision,
            claudeReview,
          });
        } catch (analysisError) {
          currentError = analysisError;
          attempts.push({
            attempt,
            errorBefore,
            claudeReview,
            outcome: "analysis_failed",
            errorAfter: errorMessage(analysisError),
          });
          continue;
        }

        previousDecision = decision;

        if (decision.codeChangeRequired || !decision.canRetry || decision.retryStrategy === "none") {
          attempts.push({
            attempt,
            errorBefore,
            decision,
            claudeReview,
            outcome: "analysis_only",
            errorAfter: errorMessage(currentError),
          });
          continue;
        }

        workingStep = applyRecoveryDecision(workingStep, decision);
        try {
          const retryResult = await runStep(workingStep, decision.reduceVariantsTo || undefined);
          if ("output" in retryResult) {
            artifacts.push(retryResult);
            attempts.push({
              attempt,
              errorBefore,
              decision,
              claudeReview,
              outcome: "succeeded",
            });
            await markTaskStep({
              supabase, taskId, userId, stepNumber: originalStep.step,
              status: "succeeded", artifact: retryResult.output,
              nextAction: `Autocorreção concluída na tentativa ${attempt}; seguir para a próxima etapa.`,
            });
            await syncTaskProgress({ supabase, taskId, userId });
            await event("recovery_succeeded", {
              step: originalStep.step,
              node: primary,
              attempt,
              decision,
              claudeReview,
            });
            recovered = true;
            break;
          }

          currentError = new Error(retryResult.reason);
          attempts.push({
            attempt,
            errorBefore,
            decision,
            claudeReview,
            outcome: "retry_blocked",
            errorAfter: retryResult.reason,
          });
          await event("recovery_retry_blocked", {
            step: originalStep.step,
            node: primary,
            attempt,
            reason: retryResult.reason,
          });
        } catch (retryError) {
          currentError = retryError;
          attempts.push({
            attempt,
            errorBefore,
            decision,
            claudeReview,
            outcome: "retry_failed",
            errorAfter: errorMessage(retryError),
          });
          await event("recovery_retry_failed", {
            step: originalStep.step,
            node: primary,
            attempt,
            error: errorMessage(retryError),
            fingerprint: errorFingerprint(retryError),
          });
        }
      }

      if (recovered) continue;

      await escalateToHuman(originalStep, primary, currentError, attempts);
      break pipelineLoop;
    }

    const finalStatus = blocked.length ? "blocked" : "succeeded";
    await syncTaskProgress({
      supabase, taskId, userId,
      fallbackNextAction: finalStatus === "succeeded" ? "Tarefa concluída." : "Resolver o bloqueio registrado e retomar do checkpoint.",
    });
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
