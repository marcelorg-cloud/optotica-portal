import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { start } from "workflow/api";
import { requireMaster, requireMasterBearer } from "../../../../../lib/require-master";
import {
  createBearerSupabaseClient,
  createServerSupabaseClient,
} from "../../../../../lib/supabase";
import {
  isValidWorkflowSecret,
  sealWorkflowSession,
} from "../../../../../lib/workflow-auth";
import { taskExecutionWorkflow } from "../../../../../workflows/task-execution";
import {
  buildCanvaSpec,
  executeCanvaBridge,
  executeCanvaInspectBridge,
  executeIndependentOpenAIReviewer,
  executeOpenAIWorker,
  isOpenAINode,
  type PipelineStep,
} from "../../../../../lib/adapters";
import {
  analyzeRecovery,
  applyRecoveryDecision,
  errorFingerprint,
  reviewRecoveryWithOpenAI,
  type RecoveryDecisionOutput,
} from "../../../../../lib/recovery";
import { executeA5LocalPreflight } from "../../../../../lib/a5-preflight";
import { evaluateResumeAuthorization } from "../../../../../lib/resume-authorization";
import { markTaskStep, syncTaskProgress } from "../../../../../lib/task-state";

export const runtime = "nodejs";
export const maxDuration = 300;
const configuredRecoveryAttempts = Number(process.env.REGENT_RECOVERY_MAX_ATTEMPTS || 3);
const RECOVERY_MAX_ATTEMPTS = Number.isFinite(configuredRecoveryAttempts)
  ? Math.max(1, Math.min(3, Math.trunc(configuredRecoveryAttempts)))
  : 3;

type Artifact = { step: number; node: string; output: unknown };
type Blocked = { step: number; nodes: string[]; reason: string; recovery?: unknown };
type Deferred = { step: number; nodes: string[]; reason: string };
type RecoveryAttempt = {
  attempt: number;
  errorBefore: string;
  decision?: RecoveryDecisionOutput | null;
  independentReview?: string | null;
  outcome: "analysis_failed" | "analysis_only" | "retry_failed" | "retry_blocked" | "succeeded";
  errorAfter?: string;
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Falha desconhecida.");
}

function reusableRunForStep(
  step: PipelineStep,
  run: { adapter?: string | null; input?: unknown; output?: unknown },
) {
  const primary = unique(step.nodes || [])[0] || "";
  if (primary !== "F6") return true;
  if (step.canvaMode === "inspect") {
    const runInput = run.input as { sourceRunIds?: unknown; designIds?: unknown } | null;
    const sameValues = (left: unknown, right: unknown) =>
      Array.isArray(left) && Array.isArray(right) &&
      JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    return run.adapter === "canva_portal_inspect" &&
      (run.output as { mode?: unknown } | null)?.mode === "inspect" &&
      sameValues(runInput?.sourceRunIds, step.canvaSourceRunIds) &&
      sameValues(runInput?.designIds, step.canvaDesignIds);
  }
  if (step.canvaMode === "create") return run.adapter === "canva_portal_bridge";
  return false;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const workflowHeader = request.headers.get("x-regent-workflow");
  const workflowExecution = Boolean(workflowHeader);

  let userId: string;
  let supabase: SupabaseClient;

  if (workflowExecution) {
    if (!isValidWorkflowSecret(workflowHeader)) {
      return NextResponse.json(
        { error: "workflow_unauthorized", message: "Execução durável não autorizada." },
        { status: 401 },
      );
    }

    const authorization = request.headers.get("authorization") || "";
    const accessToken = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    const auth = await requireMasterBearer(accessToken);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.message },
        { status: auth.status },
      );
    }

    userId = auth.userId;
    supabase = createBearerSupabaseClient(accessToken);
  } else {
    const auth = await requireMaster();
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.message },
        { status: auth.status },
      );
    }

    userId = auth.userId;
    supabase = await createServerSupabaseClient();

    const { data: queuedTask, error: queuedTaskError } = await supabase
      .from("regent_tasks")
      .select("id,status,pipeline,human_decision")
      .eq("id", taskId)
      .eq("user_id", userId)
      .maybeSingle();

    if (queuedTaskError || !queuedTask) {
      return NextResponse.json(
        { error: "task_not_found", message: "Tarefa não encontrada." },
        { status: 404 },
      );
    }

    if (queuedTask.status === "executing") {
      return NextResponse.json(
        {
          taskId,
          status: "executing",
          alreadyRunning: true,
          message: "Esta tarefa já está em execução. O Regente continuará do estado atual sem iniciar outra cópia.",
        },
        { status: 202 },
      );
    }

    if (queuedTask.status === "succeeded") {
      return NextResponse.json({
        taskId,
        status: "succeeded",
        alreadyCompleted: true,
        message: "Esta tarefa já foi concluída.",
      });
    }

    let resumeAuthorization: ReturnType<typeof evaluateResumeAuthorization> | null = null;
    if (["failed", "blocked"].includes(queuedTask.status)) {
      const { data: runtimeSteps, error: runtimeStepsError } = await supabase
        .from("regent_task_steps")
        .select("step_number,status,node_ids")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .in("status", ["failed", "blocked", "review"]);

      if (runtimeStepsError) {
        return NextResponse.json(
          { error: "resume_state_unavailable", message: "Não foi possível validar o checkpoint para retomada." },
          { status: 500 },
        );
      }

      resumeAuthorization = evaluateResumeAuthorization({
        taskStatus: queuedTask.status,
        pipeline: queuedTask.pipeline,
        humanDecision: queuedTask.human_decision,
        runtimeSteps: runtimeSteps || [],
      });
      if (!resumeAuthorization.allowed) {
        return NextResponse.json(
          {
            error: "reapproval_required",
            message: `${resumeAuthorization.reason} Autorize novamente a retomada no painel.`,
          },
          { status: 409 },
        );
      }
    } else if (queuedTask.status !== "approved") {
      return NextResponse.json(
        {
          error: "invalid_execution_state",
          message: `A tarefa está em estado ${queuedTask.status} e não precisa de uma nova autorização de execução.`,
        },
        { status: 409 },
      );
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token || !session.refresh_token) {
      return NextResponse.json(
        {
          error: "session_required",
          message: "A sessão Master precisa estar ativa para iniciar a execução durável.",
        },
        { status: 401 },
      );
    }

    const lockingAt = new Date().toISOString();
    const lockedFromStatus = queuedTask.status;
    const { data: lockedTask, error: lockError } = await supabase
      .from("regent_tasks")
      .update({
        status: "executing",
        next_action: "Preparando execução em segundo plano.",
        updated_at: lockingAt,
      })
      .eq("id", taskId)
      .eq("user_id", userId)
      .eq("status", lockedFromStatus)
      .select("id")
      .maybeSingle();

    if (lockError || !lockedTask) {
      const { data: currentTask } = await supabase
        .from("regent_tasks")
        .select("status")
        .eq("id", taskId)
        .eq("user_id", userId)
        .maybeSingle();

      if (currentTask?.status === "executing") {
        return NextResponse.json(
          {
            taskId,
            status: "executing",
            alreadyRunning: true,
            message: "Esta tarefa já está em execução. Nenhuma execução duplicada foi criada.",
          },
          { status: 202 },
        );
      }

      return NextResponse.json(
        {
          error: "execution_lock_failed",
          message: "Não foi possível reservar esta tarefa para execução.",
        },
        { status: 409 },
      );
    }

    let run;
    try {
      run = await start(taskExecutionWorkflow, [
        {
          taskId,
          userId,
          sealedSession: sealWorkflowSession({
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
          }),
          origin: new URL(request.url).origin,
        },
      ]);
    } catch (workflowError) {
      await supabase
        .from("regent_tasks")
        .update({
          status: lockedFromStatus,
          next_action: "A execução não foi iniciada. Tente novamente.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId)
        .eq("user_id", userId)
        .eq("status", "executing");

      await supabase.from("regent_task_events").insert({
        task_id: taskId,
        user_id: userId,
        event_type: "workflow_enqueue_failed",
        payload: { message: errorMessage(workflowError) },
      });

      throw workflowError;
    }

    const queuedAt = new Date().toISOString();
    await supabase.from("regent_task_events").insert({
      task_id: taskId,
      user_id: userId,
      event_type: "workflow_enqueued",
      payload: {
        run_id: run.runId,
        backend: "vercel_workflow",
        queued_at: queuedAt,
        resumed_from: resumeAuthorization?.allowed ? lockedFromStatus : null,
      },
    });

    await supabase
      .from("regent_tasks")
      .update({
        next_action:
          "Execução em segundo plano ativa. O Regente continuará mesmo com o painel fechado.",
        updated_at: queuedAt,
      })
      .eq("id", taskId)
      .eq("user_id", userId);

    return NextResponse.json(
      {
        taskId,
        status: "executing",
        runId: run.runId,
        message:
          "Execução iniciada em segundo plano. Você pode fechar o painel; o Regente continuará processando e salvará cada checkpoint.",
      },
      { status: 202 },
    );
  }

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

  const resumableStatuses = ["approved", "executing", "failed", "blocked"];
  if (!resumableStatuses.includes(taskData.status)) {
    return NextResponse.json(
      {
        error: "invalid_execution_state",
        message: `A tarefa não pode ser executada ou retomada no estado ${taskData.status}.`,
      },
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
    event_type: taskData.status === "approved" ? "execution_started" : "execution_resumed",
    payload: {
      steps: executable.map((step) => step.step),
      previous_status: taskData.status,
      durable: workflowExecution,
    },
  });

  const artifacts: Artifact[] = [];
  const blocked: Blocked[] = [];
  const deferred: Deferred[] = [];
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

    if (primary === "A5") {
      const output = await executeA5LocalPreflight({
        supabase,
        taskId,
        userId,
        step,
      });
      return { step: step.step, node: primary, output };
    }

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
          adapter: "openai_agents_independent_review",
          status: "running",
          input: { step, objective: taskData.objective },
        })
        .select("id")
        .single();
      if (runError || !runRow) throw new Error("Não foi possível registrar a execução do revisor independente A4.");

      try {
        const output = await executeIndependentOpenAIReviewer({
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
          return { step: step.step, nodes, reason: output.reason || "Revisor independente A4 indisponível." };
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
      if (step.canvaMode === "inspect") {
        const output = await executeCanvaInspectBridge({
          supabase,
          taskId,
          userId,
          step,
        });
        return { step: step.step, node: primary, output };
      }
      if (step.canvaMode !== "create") {
        throw new Error("A etapa F6 precisa declarar se vai inspecionar ou criar no Canva.");
      }
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
        supabase,
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
    const independentReviewParticipated = attempts.some((item) => Boolean(item.independentReview));
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
      independentReviewParticipated ? "O A5 e o revisor independente A4 da OpenAI participaram da análise cruzada antes do escalonamento." : "",
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
      const originalNodes = unique(originalStep.nodes || []);
      const originalPrimary = originalNodes[0] || "unknown";
      if (originalStep.executionState === "requires_adapter" && originalStep.onUnavailable === "skip") {
        const reason = `O nó ${originalPrimary} foi adiado por autorização humana porque o adapter ainda não está disponível. Nenhuma ação externa foi executada.`;
        const output = { deferred: true, node: originalPrimary, reason };
        artifacts.push({ step: originalStep.step, node: originalPrimary, output });
        deferred.push({ step: originalStep.step, nodes: originalNodes, reason });
        await markTaskStep({
          supabase, taskId, userId, stepNumber: originalStep.step,
          status: "skipped", artifact: output,
          nextAction: "Etapa adiada com segurança; seguir para a próxima dependência liberada.",
        });
        await event("adapter_deferred", { step: originalStep.step, node: originalPrimary, reason });
        await syncTaskProgress({ supabase, taskId, userId });
        continue;
      }

      const existing = await supabase
        .from("regent_tool_runs")
        .select("id, node_id, adapter, input, output")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .eq("step_number", originalStep.step)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(10);

      if (existing.error) throw new Error("Não foi possível conferir os checkpoints executados.");
      const reusableRun = existing.data?.find((run) => reusableRunForStep(originalStep, run));
      if (reusableRun) {
        artifacts.push({ step: originalStep.step, node: reusableRun.node_id, output: reusableRun.output });
        await markTaskStep({
          supabase, taskId, userId, stepNumber: originalStep.step,
          status: "succeeded", artifact: reusableRun.output,
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
          !dependencyRows.data?.some((row) => row.step_number === dep && ["succeeded", "skipped"].includes(row.status))
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
        let independentReview: string | null = null;

        if (attempt >= 2 && previousDecision) {
          try {
            const review = await reviewRecoveryWithOpenAI({
              objective: taskData.objective,
              taskTitle: taskData.title,
              step: workingStep,
              node: primary,
              error: currentError,
              firstDecision: previousDecision,
            });
            independentReview = review.review;
            await event("recovery_a4_review", {
              step: originalStep.step,
              node: primary,
              attempt,
              available: review.available,
              review: review.review,
            });
          } catch (reviewError) {
            independentReview = `Revisor independente A4 indisponível nesta tentativa: ${errorMessage(reviewError)}`;
            await event("recovery_a4_failed", {
              step: originalStep.step,
              node: primary,
              attempt,
              error: errorMessage(reviewError),
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
            independentReview,
            recurrence: attempt,
          });
          await event("recovery_a5_analysis", {
            step: originalStep.step,
            node: primary,
            recurrence: attempt,
            decision,
            independentReview,
          });
        } catch (analysisError) {
          currentError = analysisError;
          attempts.push({
            attempt,
            errorBefore,
            independentReview,
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
            independentReview,
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
              independentReview,
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
              independentReview,
            });
            recovered = true;
            break;
          }

          currentError = new Error(retryResult.reason);
          attempts.push({
            attempt,
            errorBefore,
            decision,
            independentReview,
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
            independentReview,
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

    const finalStatus = humanEscalation ? "failed" : blocked.length ? "blocked" : "succeeded";
    await syncTaskProgress({
      supabase, taskId, userId,
      fallbackNextAction: finalStatus === "succeeded"
        ? deferred.length
          ? "Tarefa concluída no escopo disponível; integrações adiadas podem ser configuradas depois."
          : "Tarefa concluída."
        : "Resolver o bloqueio registrado e retomar do checkpoint.",
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
      { artifacts, blocked, deferred },
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
      deferred.length
        ? `Etapas adiadas sem execução externa:\n${deferred.map((item) => `Etapa ${item.step}: ${item.reason}`).join("\n")}`
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
      deferred,
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

    await event("execution_failed", { message, artifacts, blocked, deferred });

    return NextResponse.json(
      { error: "execution_failed", message, artifacts, blocked, deferred },
      { status: 500 },
    );
  }
}
