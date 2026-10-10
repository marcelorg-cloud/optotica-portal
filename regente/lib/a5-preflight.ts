import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStep } from "./adapters";
import { redactSecrets } from "./phase-control.ts";

type PersistedTask = {
  id: string;
  status: string;
  current_step: number | null;
  progress_percent: number | null;
  next_action: string | null;
  blocked_reason: string | null;
  pipeline: unknown;
};

type PersistedStep = {
  step_number: number;
  status: string;
  depends_on: number[] | null;
  node_ids: string[] | null;
  action: string | null;
  next_action: string | null;
  revision?: number;
};

type PersistedRun = {
  id: string;
  step_number: number;
  node_id: string;
  adapter: string;
  status: string;
  created_at: string;
};

type CapabilityState = {
  adapter: string;
  connected: boolean;
  credentialConfigured?: boolean;
  operationalVerification?: "verified_by_scoped_reads" | "not_verified";
};

export type A5PreflightReport = {
  kind: "local_recovery_preflight";
  generatedAt: string;
  persistedState: {
    taskStatus: string;
    currentStep: number | null;
    progressPercent: number;
    nextAction: string | null;
    blockedReason: string | null;
    totalSteps: number;
  };
  /** Reuse eligibility requires revision/input fingerprint checks in the executor. */
  reusableSucceededRuns: [];
  historicalSucceededRuns: Array<{
    runId: string;
    step: number;
    node: string;
    adapter: string;
    createdAt: string;
    currentStepStatus: string | null;
    currentStepRevision: number | null;
    reuseVerified: false;
  }>;
  completedSteps: number[];
  pendingDependencies: Array<{
    step: number;
    dependsOn: number[];
    unresolved: number[];
  }>;
  blockers: Array<{
    step: number;
    status: string;
    nodes: string[];
    reason: string;
  }>;
  prospectiveContinuation: {
    assumedCompletedStep: number;
    nextStep: number | null;
    node: string | null;
    dependenciesSatisfied: boolean;
  };
  capabilityInventory: Record<
    "supabaseRls" | "A1" | "A2" | "A3" | "A4" | "A5" | "F6" | "F12" | "F13",
    CapabilityState
  >;
  verificationLimits: {
    costLimits: "not_verifiable";
    documentInputs: "not_verifiable";
    canvaOAuth: "not_verified";
    historicalRunReuse: "not_verified";
  };
  executionSafety: {
    scopedByTaskIdAndUserId: true;
    secretValuesIncluded: false;
    providerCallsPerformed: false;
    additionalAiConsumption: false;
  };
};

function normalizePipeline(value: unknown): PipelineStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter((step): step is PipelineStep => {
    if (!step || typeof step !== "object") return false;
    const candidate = step as Partial<PipelineStep>;
    return Number.isInteger(candidate.step) && Array.isArray(candidate.nodes);
  });
}

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function safeText(value: string | null | undefined, limit = 1200) {
  return typeof value === "string" ? redactSecrets(value).slice(0, limit) : null;
}

export function buildA5PreflightReport(input: {
  task: PersistedTask;
  steps: PersistedStep[];
  succeededRuns: PersistedRun[];
  a5StepNumber: number;
  openAICredentialConfigured: boolean;
  generatedAt?: string;
}): A5PreflightReport {
  const pipeline = normalizePipeline(input.task.pipeline);
  // A historical run can outlive an invalidated/revised checkpoint. It does not
  // make that CURRENT phase completed and cannot satisfy its dependencies.
  const completedSteps = uniqueSorted(input.steps
    .filter((step) => ["succeeded", "skipped"].includes(step.status)).map((step) => step.step_number));
  const completedSet = new Set(completedSteps);
  const prospectiveCompleted = new Set([...completedSteps, input.a5StepNumber]);

  const pendingDependencies = input.steps
    .filter((step) => !["succeeded", "skipped"].includes(step.status))
    .map((step) => {
      const dependsOn = uniqueSorted(step.depends_on || []);
      return {
        step: step.step_number,
        dependsOn,
        unresolved: dependsOn.filter((dependency) => !completedSet.has(dependency)),
      };
    })
    .filter((step) => step.unresolved.length > 0);

  const blockers = input.steps
    .filter((step) => ["blocked", "failed", "review"].includes(step.status))
    .map((step) => ({
      step: step.step_number,
      status: step.status,
      nodes: (step.node_ids || []).map((node) => safeText(node, 120) || "unknown"),
      reason: safeText(step.next_action || step.action) || "Bloqueio persistido sem descrição adicional.",
    }));

  const nextStep = [...input.steps]
    .sort((left, right) => left.step_number - right.step_number)
    .find((step) => {
      if (step.step_number <= input.a5StepNumber || prospectiveCompleted.has(step.step_number)) return false;
      // Database edges are authoritative, including legacy plans without dependsOn.
      return (step.depends_on || []).every((dependency) => prospectiveCompleted.has(dependency));
    }) || null;

  const openAI = (adapter: string): CapabilityState => ({
    adapter,
    connected: true,
    credentialConfigured: input.openAICredentialConfigured,
  });

  return {
    kind: "local_recovery_preflight",
    generatedAt: input.generatedAt || new Date().toISOString(),
    persistedState: {
      taskStatus: input.task.status,
      currentStep: input.task.current_step,
      progressPercent: Number(input.task.progress_percent || 0),
      nextAction: safeText(input.task.next_action),
      blockedReason: safeText(input.task.blocked_reason),
      totalSteps: input.steps.length,
    },
    reusableSucceededRuns: [],
    historicalSucceededRuns: input.succeededRuns.map((run) => ({
      runId: run.id,
      step: run.step_number,
      node: safeText(run.node_id, 120) || "unknown",
      adapter: safeText(run.adapter, 120) || "unknown",
      createdAt: run.created_at,
      currentStepStatus: input.steps.find((step) => step.step_number === run.step_number)?.status || null,
      currentStepRevision: input.steps.find((step) => step.step_number === run.step_number)?.revision ?? null,
      reuseVerified: false,
    })),
    completedSteps,
    pendingDependencies,
    blockers,
    prospectiveContinuation: {
      assumedCompletedStep: input.a5StepNumber,
      nextStep: nextStep?.step_number || null,
      node: safeText(nextStep?.node_ids?.[0] || pipeline.find((step) => step.step === nextStep?.step_number)?.nodes?.[0], 120),
      dependenciesSatisfied: Boolean(nextStep),
    },
    capabilityInventory: {
      supabaseRls: {
        adapter: "authenticated_supabase_rls",
        connected: true,
        operationalVerification: "verified_by_scoped_reads",
      },
      A1: openAI("openai_agents"),
      A2: openAI("openai_agents"),
      A3: openAI("openai_agents"),
      A4: openAI("openai_agents_independent_review"),
      A5: { adapter: "local_recovery_preflight", connected: true },
      F6: {
        adapter: "canva_portal_bridge",
        connected: true,
        operationalVerification: "not_verified",
      },
      F12: { adapter: "unavailable", connected: false },
      F13: { adapter: "unavailable", connected: false },
    },
    verificationLimits: {
      costLimits: "not_verifiable",
      documentInputs: "not_verifiable",
      canvaOAuth: "not_verified",
      historicalRunReuse: "not_verified",
    },
    executionSafety: {
      scopedByTaskIdAndUserId: true,
      secretValuesIncluded: false,
      providerCallsPerformed: false,
      additionalAiConsumption: false,
    },
  };
}

export async function executeA5LocalPreflight(input: {
  supabase: SupabaseClient;
  taskId: string;
  userId: string;
  step: PipelineStep;
}) {
  const { data: runRow, error: runError } = await input.supabase
    .from("regent_tool_runs")
    .insert({
      task_id: input.taskId,
      user_id: input.userId,
      step_number: input.step.step,
      node_id: "A5",
      adapter: "local_recovery_preflight",
      status: "running",
      input: {
        operation: "inspect_persisted_recovery_state",
        scoped: true,
      },
    })
    .select("id")
    .single();

  if (runError || !runRow) {
    throw new Error("Não foi possível registrar o preflight local A5.");
  }

  try {
    const [taskResult, stepsResult, runsResult] = await Promise.all([
      input.supabase
        .from("regent_tasks")
        .select("id,status,current_step,progress_percent,next_action,blocked_reason,pipeline")
        .eq("id", input.taskId)
        .eq("user_id", input.userId)
        .maybeSingle(),
      input.supabase
        .from("regent_task_steps")
        .select("step_number,status,depends_on,node_ids,action,next_action,revision")
        .eq("task_id", input.taskId)
        .eq("user_id", input.userId)
        .order("step_number", { ascending: true }),
      input.supabase
        .from("regent_tool_runs")
        .select("id,step_number,node_id,adapter,status,created_at")
        .eq("task_id", input.taskId)
        .eq("user_id", input.userId)
        .eq("status", "succeeded")
        .order("created_at", { ascending: true }),
    ]);

    if (taskResult.error || !taskResult.data) {
      throw new Error("Não foi possível ler o estado persistente autenticado da tarefa no preflight A5.");
    }
    if (stepsResult.error) throw new Error("Não foi possível ler os checkpoints autenticados no preflight A5.");
    if (runsResult.error) throw new Error("Não foi possível ler o histórico autenticado de runs no preflight A5.");

    const report = buildA5PreflightReport({
      task: taskResult.data as PersistedTask,
      steps: (stepsResult.data || []) as PersistedStep[],
      succeededRuns: (runsResult.data || []) as PersistedRun[],
      a5StepNumber: input.step.step,
      openAICredentialConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    });

    const { error: updateError } = await input.supabase
      .from("regent_tool_runs")
      .update({ status: "succeeded", output: report, updated_at: new Date().toISOString() })
      .eq("id", runRow.id)
      .eq("task_id", input.taskId)
      .eq("user_id", input.userId);
    if (updateError) throw new Error("Não foi possível persistir o relatório do preflight A5.");

    return report;
  } catch (error) {
    const allowed = [
      "Não foi possível ler o estado persistente autenticado da tarefa no preflight A5.",
      "Não foi possível ler os checkpoints autenticados no preflight A5.",
      "Não foi possível ler o histórico autenticado de runs no preflight A5.",
      "Não foi possível persistir o relatório do preflight A5.",
    ];
    const description = error instanceof Error && allowed.includes(error.message)
      ? error.message : "O preflight local A5 não pôde confirmar o estado autenticado. Nenhuma continuação foi autorizada.";
    try {
      const saved = await input.supabase.from("regent_tool_runs").update({
        status: "failed", output: { message: description }, updated_at: new Date().toISOString(),
      }).eq("id", runRow.id).eq("task_id", input.taskId).eq("user_id", input.userId);
      if (saved.error) console.warn("regente_a5_failure_status_unconfirmed", { taskId: input.taskId, runId: runRow.id });
    } catch {
      console.warn("regente_a5_failure_status_unconfirmed", { taskId: input.taskId, runId: runRow.id });
    }
    throw new Error(description);
  }
}
