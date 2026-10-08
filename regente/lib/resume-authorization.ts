import type { PipelineStep } from "./adapters";

type HumanDecision = {
  decision?: string;
  decided_at?: string;
  approval_scope?: string | null;
  approved_steps?: number[] | null;
  approved_pipeline_steps?: number[] | null;
  recovery_authorized?: boolean;
} | null;

type RuntimeStep = {
  step_number: number;
  status: string;
  node_ids: string[] | null;
};

export type A5ResumeAuthorization = {
  allowed: boolean;
  reason: string;
  a5Steps: number[];
};

export type ResumeAuthorization = {
  allowed: boolean;
  reason: string;
  pausedSteps: number[];
};

function asStepSet(value: unknown) {
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is number => Number.isInteger(item) && Number(item) > 0)
      : [],
  );
}

export function a5PipelineSteps(pipeline: unknown): number[] {
  if (!Array.isArray(pipeline)) return [];
  return pipeline
    .filter((step): step is PipelineStep => Boolean(
      step &&
      typeof step === "object" &&
      Number.isInteger((step as Partial<PipelineStep>).step) &&
      Array.isArray((step as Partial<PipelineStep>).nodes),
    ))
    .filter((step) => step.nodes.includes("A5"))
    .map((step) => step.step);
}

export function pipelineStepNumbers(pipeline: unknown): number[] {
  if (!Array.isArray(pipeline)) return [];
  return pipeline
    .filter((step): step is PipelineStep => Boolean(
      step &&
      typeof step === "object" &&
      Number.isInteger((step as Partial<PipelineStep>).step) &&
      Array.isArray((step as Partial<PipelineStep>).nodes),
    ))
    .map((step) => step.step);
}

export function evaluateResumeAuthorization(input: {
  taskStatus: string;
  pipeline: unknown;
  humanDecision: HumanDecision;
  runtimeSteps: RuntimeStep[];
}): ResumeAuthorization {
  const pipelineSteps = new Set(pipelineStepNumbers(input.pipeline));
  const pausedSteps = [...new Set(input.runtimeSteps
    .filter((step) => ["failed", "blocked", "review"].includes(step.status))
    .map((step) => step.step_number)
    .filter((step) => pipelineSteps.has(step)))];

  if (!["failed", "blocked"].includes(input.taskStatus)) {
    return { allowed: false, reason: "A tarefa não está pausada em estado retomável.", pausedSteps };
  }
  if (!pausedSteps.length) {
    return { allowed: false, reason: "Nenhuma etapa pausada foi comprovada no estado persistente.", pausedSteps };
  }

  const decision = input.humanDecision;
  if (
    !decision ||
    decision.recovery_authorized !== true ||
    !["execute", "partial"].includes(decision.decision || "") ||
    !decision.decided_at
  ) {
    return {
      allowed: false,
      reason: "É necessária uma decisão humana persistida e específica para esta retomada.",
      pausedSteps,
    };
  }

  const approved = decision.decision === "partial"
    ? asStepSet(decision.approved_steps)
    : asStepSet(decision.approved_pipeline_steps);
  const unapproved = pausedSteps.filter((step) => !approved.has(step));
  if (unapproved.length) {
    return {
      allowed: false,
      reason: `A decisão humana não autoriza explicitamente as etapas pausadas ${unapproved.join(", ")}.`,
      pausedSteps,
    };
  }

  return {
    allowed: true,
    reason: "Decisão humana persistida autoriza explicitamente a retomada das etapas pausadas.",
    pausedSteps,
  };
}

export function evaluateA5ResumeAuthorization(input: {
  taskStatus: string;
  pipeline: unknown;
  humanDecision: HumanDecision;
  runtimeSteps: RuntimeStep[];
}): A5ResumeAuthorization {
  const a5Steps = a5PipelineSteps(input.pipeline);
  if (!["failed", "blocked"].includes(input.taskStatus)) {
    return { allowed: false, reason: "A tarefa não está pausada em estado retomável.", a5Steps };
  }
  if (!a5Steps.length) {
    return { allowed: false, reason: "A pipeline não contém uma etapa A5.", a5Steps };
  }

  const blockedA5Steps = input.runtimeSteps
    .filter((step) =>
      ["failed", "blocked", "review"].includes(step.status) &&
      Array.isArray(step.node_ids) &&
      step.node_ids.includes("A5"),
    )
    .map((step) => step.step_number);
  if (!blockedA5Steps.length) {
    return {
      allowed: false,
      reason: "Nenhuma etapa A5 pausada foi comprovada no estado persistente.",
      a5Steps,
    };
  }

  const decision = input.humanDecision;
  if (
    !decision ||
    !["execute", "partial"].includes(decision.decision || "") ||
    !decision.decided_at
  ) {
    return {
      allowed: false,
      reason: "É necessária uma decisão humana persistida para retomar A5.",
      a5Steps,
    };
  }

  const approved = decision.decision === "partial"
    ? asStepSet(decision.approved_steps)
    : asStepSet(decision.approved_pipeline_steps);
  const unapproved = blockedA5Steps.filter((step) => !approved.has(step));
  if (unapproved.length) {
    return {
      allowed: false,
      reason: `A decisão humana não autoriza explicitamente A5 nas etapas ${unapproved.join(", ")}.`,
      a5Steps,
    };
  }

  return {
    allowed: true,
    reason: "Decisão humana persistida autoriza explicitamente a retomada A5.",
    a5Steps,
  };
}
