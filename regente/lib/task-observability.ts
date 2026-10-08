type TaskLike = {
  status: string;
  current_step?: number | null;
  next_action?: string | null;
  blocked_reason?: string | null;
};

type StepLike = {
  step_number: number;
  status: string;
  attempt_count?: number | null;
  last_error?: unknown;
  next_action?: string | null;
};

export type TaskAttention = {
  kind: "ready" | "approval" | "recovering" | "blocked" | "failed" | "stale";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  action: "start" | "approve" | "resume" | "refresh";
  step: number | null;
  attempts: number;
  error: string | null;
} | null;

export type TaskRecoverySummary = {
  active: boolean;
  currentStep: number | null;
  currentAttempt: number;
  recoveredStep: number | null;
  recoveredAttempts: number;
  lastError: string | null;
} | null;

function errorMessage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === "string" && message.trim() ? message.trim() : null;
  }
  return null;
}

export function deriveTaskObservability(input: {
  task: TaskLike;
  steps: StepLike[];
  isStale: boolean;
}): { attention: TaskAttention; recovery: TaskRecoverySummary } {
  const activeStep = input.steps.find((step) => ["running", "review"].includes(step.status)) || null;
  const blockedStep = input.steps.find((step) => ["failed", "blocked"].includes(step.status)) || null;
  const currentStep = activeStep || blockedStep || input.steps.find(
    (step) => step.step_number === input.task.current_step,
  ) || null;
  const currentAttempts = Number(currentStep?.attempt_count || 0);
  const currentError = errorMessage(currentStep?.last_error);
  const recoveredStep = [...input.steps]
    .reverse()
    .find((step) =>
      step.status === "succeeded" &&
      Number(step.attempt_count || 0) > 1 &&
      Boolean(errorMessage(step.last_error)),
    ) || null;
  const recovering = Boolean(activeStep && currentAttempts > 1);

  const recovery: TaskRecoverySummary = recovering || recoveredStep
    ? {
        active: recovering,
        currentStep: recovering ? activeStep?.step_number || null : null,
        currentAttempt: recovering ? currentAttempts : 0,
        recoveredStep: recoveredStep?.step_number || null,
        recoveredAttempts: Number(recoveredStep?.attempt_count || 0),
        lastError: currentError || errorMessage(recoveredStep?.last_error),
      }
    : null;

  if (input.isStale) {
    return {
      recovery,
      attention: {
        kind: "stale",
        severity: "warning",
        title: "Execução sem atualização",
        message: "O monitor não recebeu um novo checkpoint há mais de 15 minutos. Atualize o estado antes de decidir uma retomada.",
        action: "refresh",
        step: currentStep?.step_number || input.task.current_step || null,
        attempts: currentAttempts,
        error: currentError,
      },
    };
  }

  if (["failed", "blocked"].includes(input.task.status)) {
    const failed = input.task.status === "failed";
    return {
      recovery,
      attention: {
        kind: failed ? "failed" : "blocked",
        severity: "critical",
        title: failed ? "A execução precisa de intervenção" : "A execução está bloqueada",
        message:
          input.task.blocked_reason ||
          currentStep?.next_action ||
          currentError ||
          "A recuperação automática foi encerrada e é necessária uma decisão humana.",
        action: "resume",
        step: blockedStep?.step_number || input.task.current_step || null,
        attempts: Number(blockedStep?.attempt_count || currentAttempts),
        error: errorMessage(blockedStep?.last_error) || currentError,
      },
    };
  }

  if (input.task.status === "awaiting_approval") {
    return {
      recovery,
      attention: {
        kind: "approval",
        severity: "warning",
        title: "Autorização necessária",
        message: input.task.next_action || "Revise o plano e autorize a execução supervisionada.",
        action: "approve",
        step: input.task.current_step || null,
        attempts: currentAttempts,
        error: currentError,
      },
    };
  }

  if (input.task.status === "approved") {
    return {
      recovery,
      attention: {
        kind: "ready",
        severity: "info",
        title: "Pipeline pronta para iniciar",
        message: input.task.next_action || "O plano está aprovado e ainda não foi enfileirado.",
        action: "start",
        step: input.task.current_step || null,
        attempts: currentAttempts,
        error: currentError,
      },
    };
  }

  if (recovering) {
    return {
      recovery,
      attention: {
        kind: "recovering",
        severity: "warning",
        title: "Autocorreção em andamento",
        message: `O Regente está tentando corrigir a etapa ${activeStep?.step_number} sem perder checkpoints.`,
        action: "refresh",
        step: activeStep?.step_number || null,
        attempts: currentAttempts,
        error: currentError,
      },
    };
  }

  return { attention: null, recovery };
}
