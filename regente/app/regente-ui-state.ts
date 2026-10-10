import type { TaskAttention, TaskRecoverySummary } from "../lib/task-observability";

export type PipelineStep = {
  step: number;
  role: string;
  nodes: string[];
  action: string;
  input: string;
  expectedOutput: string;
  executionState: string;
  requiresApproval: boolean;
  dependsOn?: number[];
  checkpoint?: boolean;
  onUnavailable?: "block" | "skip";
  optional?: boolean;
};

export type RuntimeStep = {
  step_number: number;
  role?: string;
  node_ids?: string[];
  action?: string;
  status: string;
  depends_on: number[];
  attempt_count: number;
  last_error?: { message?: string } | string | null;
  next_action?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  revision?: number;
  validated_at?: string | null;
  artifact?: unknown;
};

export type PhaseReport = {
  step: number;
  revision?: number;
  title?: string;
  summary?: string;
  completedAt?: string;
  nextStep?: number | null;
  final?: boolean;
  output?: unknown;
  limitations?: string[];
};

export type TaskRuntime = {
  currentStep?: number | null;
  progressPercent?: number;
  nextAction?: string | null;
  autonomyLevel?: number;
  blockedReason?: string | null;
  lastError?: unknown;
  updatedAt?: string;
  isStale?: boolean;
  lastActivityAt?: string | null;
  steps?: RuntimeStep[];
  attention?: TaskAttention;
  recovery?: TaskRecoverySummary;
  phaseReport?: PhaseReport | null;
  phase_report?: PhaseReport | null;
  validatedSteps?: number[];
  validated_steps?: number[];
  controlRevision?: number;
  control_revision?: number;
  engineVersion?: string;
  engine_version?: string;
  workflowRunId?: string | null;
  workflow_run_id?: string | null;
  executionLeaseUntil?: string | null;
  execution_lease_until?: string | null;
};

export type PlanPayload = {
  message?: string;
  status: "proceed" | "needs_human" | "blocked";
  summary: string;
  objective: string;
  taskTitle?: string;
  priority: string;
  depth?: string;
  risk?: string;
  selectedNodes: string[];
  pipeline?: PipelineStep[];
  actions: { step: number; node: string; action: string; reason: string }[];
  picker?: {
    enabled: boolean;
    criteria: string[];
    variantsRequested: number;
    recommendationMode: string;
  };
  sanityChecks: { rule: string; status: string; note: string }[];
  estimatedComplexity: string;
  approvalRequired?: boolean;
  humanDecision: string | null;
  nextAction?: string;
  autonomyLevel?: number;
  taskId?: string;
  taskStatus?: string;
  runtime?: TaskRuntime;
};

export type ChatMessage = {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  payload?: (Partial<PlanPayload> & { notification?: boolean; phase?: number; engineVersion?: string }) | null;
  created_at?: string;
};

export const SETTLED_TASK_STATUSES = new Set([
  "awaiting_approval", "awaiting_validation", "succeeded", "blocked", "failed", "rejected", "needs_revision",
]);

const TASK_STATUS_LABELS: Record<string, string> = {
  awaiting_approval: "Aguardando autorização",
  awaiting_validation: "Valide esta fase",
  approved: "Etapa autorizada",
  executing: "Em execução",
  succeeded: "Finalizada",
  blocked: "Bloqueada: ação necessária",
  failed: "Pausada: correção necessária",
  needs_revision: "Aguardando nova orientação",
  rejected: "Encerrada",
};

const STEP_STATUS_LABELS: Record<string, string> = {
  planned: "Planejada",
  prepared: "Preparada",
  ready: "Adapter disponível",
  requires_adapter: "Conexão pendente",
  awaiting_approval: "Aguardando autorização",
  running: "Executando",
  review: "Em recuperação",
  succeeded: "Output produzido",
  blocked: "Bloqueada",
  failed: "Falhou",
  skipped: "Pulada com autorização",
};

const ROLE_LABELS: Record<string, string> = {
  preflight: "Verificação da orquestra",
  reference: "Referência",
  planning: "Planejamento",
  creative: "Criação de conceitos",
  critic: "Revisão crítica",
  creation: "Produção",
  picker: "Seleção supervisionada",
  validation: "Validação",
};

export function taskStatusLabel(status?: string) {
  return status ? TASK_STATUS_LABELS[status] || "Estado não reconhecido" : "Carregando estado";
}

export function stepStatusLabel(status?: string, validatedAt?: string | null) {
  if (validatedAt && status === "succeeded") return "Validada por você";
  return status ? STEP_STATUS_LABELS[status] || "Estado não reconhecido" : "Planejada";
}

export function roleLabel(role?: string) {
  return role ? ROLE_LABELS[role] || role : "Fase";
}

export function phaseReportOf(runtime?: TaskRuntime) {
  return runtime?.phaseReport || runtime?.phase_report || null;
}

export function validatedStepsOf(runtime?: TaskRuntime) {
  return runtime?.validatedSteps || runtime?.validated_steps || [];
}

export function controlRevisionOf(runtime?: TaskRuntime) {
  return runtime?.controlRevision ?? runtime?.control_revision ?? 0;
}

export function engineVersionOf(runtime?: TaskRuntime) {
  return runtime?.engineVersion || runtime?.engine_version || "não informada";
}

export function runtimeCounts(runtime?: TaskRuntime) {
  const steps = runtime?.steps || [];
  const validated = new Set(validatedStepsOf(runtime));
  return {
    produced: steps.filter((step) => step.status === "succeeded").length,
    validated: steps.filter((step) => validated.has(step.step_number) || Boolean(step.validated_at)).length,
    skipped: steps.filter((step) => step.status === "skipped").length,
    failed: steps.filter((step) => ["failed", "blocked", "review"].includes(step.status)).length,
    pending: steps.filter((step) => ["planned", "prepared", "awaiting_approval"].includes(step.status)).length,
    total: steps.length,
  };
}

export function taskUpdatedLabel(value?: string | null) {
  if (!value) return "Horário não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horário não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function errorMessage(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return null;
}

export function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "result" in value && typeof value.result === "string") {
    return value.result;
  }
  return value == null ? "Nenhum conteúdo informado no relatório." : JSON.stringify(value, null, 2);
}

export function needsRecovery(payload: PlanPayload, now = Date.now()) {
  if (["blocked", "failed"].includes(payload.taskStatus || "")) return true;
  if (payload.taskStatus !== "executing") return false;
  const lease = payload.runtime?.executionLeaseUntil || payload.runtime?.execution_lease_until;
  return Boolean(payload.runtime?.isStale || (lease && new Date(lease).getTime() <= now));
}

export function missionPlans(messages: ChatMessage[]) {
  const byId = new Map<string, PlanPayload>();
  for (const item of messages) {
    const payload = item.payload;
    if (!payload?.taskId) continue;
    const previous = byId.get(payload.taskId);
    if (previous) {
      byId.set(payload.taskId, {
        ...previous,
        ...payload,
        runtime: payload.runtime ? { ...previous.runtime, ...payload.runtime } : previous.runtime,
      });
    } else if (Array.isArray(payload.pipeline) && typeof payload.summary === "string") {
      byId.set(payload.taskId, payload as PlanPayload);
    }
  }
  return [...byId.values()];
}

export function runtimeFromTask(task: Record<string, unknown>, steps: RuntimeStep[]): TaskRuntime {
  return {
    currentStep: task.current_step as number | null,
    progressPercent: task.progress_percent as number,
    nextAction: task.next_action as string | null,
    autonomyLevel: task.autonomy_level as number,
    blockedReason: task.blocked_reason as string | null,
    lastError: task.last_error,
    updatedAt: task.updated_at as string,
    isStale: Boolean(task.is_stale),
    lastActivityAt: task.last_activity_at as string | null,
    steps,
    attention: (task.attention || null) as TaskAttention,
    recovery: (task.recovery || null) as TaskRecoverySummary,
    phaseReport: (task.phase_report || null) as PhaseReport | null,
    validatedSteps: (task.validated_steps || []) as number[],
    controlRevision: Number(task.control_revision ?? 0),
    engineVersion: task.engine_version as string,
    workflowRunId: task.workflow_run_id as string | null,
    executionLeaseUntil: task.execution_lease_until as string | null,
  };
}

export function safeOutputLinks(links: unknown) {
  if (!Array.isArray(links)) return [];
  return links.filter((link): link is string => {
    if (typeof link !== "string") return false;
    try {
      const url = new URL(link);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  });
}
