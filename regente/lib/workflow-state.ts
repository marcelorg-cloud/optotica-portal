/** Metadata-only policy: never expose serialized Workflow input, output or errors. */
export type WorkflowFailureKind =
  | "configuration"
  | "authentication"
  | "session"
  | "conflict"
  | "timeout"
  | "dispatch_unknown"
  | "response_invalid";

const FAILURE_MESSAGES: Record<WorkflowFailureKind, string> = {
  configuration: "[REGENT_WORKFLOW_CONFIGURATION] A configuração da execução durável é inválida. Confira o ambiente de produção antes de autorizar outra tentativa.",
  authentication: "[REGENT_WORKFLOW_AUTHENTICATION] A sessão ou a autorização Master da execução durável não foi confirmada. Reentre no portal antes de autorizar outra tentativa.",
  session: "[REGENT_WORKFLOW_SESSION] A sessão protegida não pôde ser renovada ou validada. Reentre no portal; nenhum fallback de credenciais será usado.",
  conflict: "[REGENT_WORKFLOW_CONFLICT] A reserva ou o estado desta execução mudou. Atualize o monitor; esta invocação não será repetida automaticamente.",
  timeout: "[REGENT_WORKFLOW_TIMEOUT] A confirmação da execução excedeu o prazo. O servidor pode ter iniciado a fase; confira o estado e os outputs antes de autorizar outra tentativa.",
  dispatch_unknown: "[REGENT_WORKFLOW_DISPATCH_UNKNOWN] Não foi possível confirmar a resposta da execução. A fase pode ter sido iniciada; não haverá repetição automática.",
  response_invalid: "[REGENT_WORKFLOW_RESPONSE_INVALID] O servidor não retornou uma confirmação válida. Confira o estado persistente e os outputs; não haverá repetição automática.",
};

export function workflowFailureMessage(kind: WorkflowFailureKind) {
  return FAILURE_MESSAGES[kind];
}

/** Only our own finite tags are consumed; raw exception text is never returned. */
export function workflowFailureKind(error: unknown): WorkflowFailureKind {
  const message = error && typeof error === "object" && "message" in error
    ? (error as { message?: unknown }).message : error;
  if (typeof message !== "string") return "dispatch_unknown";
  for (const [kind, text] of Object.entries(FAILURE_MESSAGES)) {
    const tag = text.slice(0, text.indexOf("]") + 1);
    if (message.includes(tag)) return kind as WorkflowFailureKind;
  }
  return "dispatch_unknown";
}

export function workflowHttpFailure(status: number): WorkflowFailureKind {
  if (status === 401 || status === 403) return "authentication";
  if (status === 409) return "conflict";
  if ([400, 404, 405, 422].includes(status)) return "configuration";
  if (status === 408 || status === 504) return "timeout";
  // A 5xx or transport failure does not prove that a side effect was rejected.
  return "dispatch_unknown";
}

function origin(value: string, localDevelopmentAllowed = false) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
    const localDevelopment = localDevelopmentAllowed && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localDevelopment) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function safeWorkflowOrigin(value: string, production: boolean, env: Record<string, string | undefined> = process.env) {
  const candidate = origin(value, !production);
  if (!candidate || !production) return candidate;
  // A spoofed Host/request origin must never become a bearer-token destination.
  const trusted = new Set(["https://optotica-regente.vercel.app"]);
  const configured = origin(env.REGENT_APP_ORIGIN || "");
  if (configured) trusted.add(configured);
  for (const name of ["VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) {
    const hostname = env[name]?.trim();
    if (!hostname) continue;
    const configuredOrigin = origin(hostname.startsWith("https://") ? hostname : `https://${hostname}`);
    if (configuredOrigin) trusted.add(configuredOrigin);
  }
  return trusted.has(candidate) ? candidate : null;
}

/** SDK 5 uses wrun_ followed by a Crockford ULID; no arbitrary ID is fetched. */
export function safeWorkflowRunId(value: unknown) {
  return typeof value === "string" && /^wrun_[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value) ? value : null;
}

export const WORKFLOW_ERROR_CODES = new Set([
  "USER_ERROR", "MAX_EVENTS_EXCEEDED", "MAX_DELIVERIES_EXCEEDED", "REPLAY_TIMEOUT",
  "REPLAY_DIVERGENCE", "CORRUPTED_EVENT_LOG", "STREAM_ERROR", "WORLD_CONTRACT_ERROR",
  "DEPLOYMENT_MISMATCH", "RUNTIME_ERROR",
]);
const WORKFLOW_STATUSES = new Set(["pending", "running", "completed", "failed", "cancelled"]);

export type WorkflowObservation = {
  verified: boolean;
  runId: string | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | null;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  checkedAt: string;
  deploymentChanged: boolean | null;
  detail: string;
  inputOutputLoaded: false;
};

function date(value: unknown) {
  if (!(typeof value === "string" || typeof value === "number" || value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function workflowObservation(input: {
  runId?: string | null;
  run?: Record<string, unknown> | null;
  currentDeploymentId?: string;
  now?: number;
  reason?: "not_linked" | "unavailable" | "timeout" | "invalid_run";
}): WorkflowObservation {
  const run = input.run;
  const runId = safeWorkflowRunId(input.runId);
  const valid = Boolean(runId && run?.runId === runId && WORKFLOW_STATUSES.has(String(run?.status)) &&
    typeof run?.workflowName === "string" && run.workflowName.endsWith("//taskExecutionWorkflow"));
  const status = valid ? run!.status as WorkflowObservation["status"] : null;
  const errorCode = valid && typeof run?.errorCode === "string" && WORKFLOW_ERROR_CODES.has(run.errorCode) ? run.errorCode : null;
  const deploymentChanged = valid && typeof run?.deploymentId === "string" && input.currentDeploymentId
    ? run.deploymentId !== input.currentDeploymentId : null;
  const detail = !valid
    ? !runId || input.reason === "not_linked" ? "Nenhum Workflow está vinculado a esta missão."
      : input.reason === "timeout" ? "A consulta ao Workflow excedeu o prazo; o estado do banco permanece a referência."
        : "Não foi possível confirmar o estado do Workflow. Nenhuma execução ou credencial alternativa foi acionada."
    : status === "failed" ? "O Workflow falhou. Isso não confirma a falha de todos os outputs nem autoriza repetir a fase."
      : status === "cancelled" ? "O Workflow foi cancelado. Os checkpoints persistidos continuam preservados."
        : status === "completed" ? "O Workflow terminou; a conclusão e a validação da missão dependem do estado persistente."
          : deploymentChanged ? "Esta execução permanece vinculada ao deployment que a iniciou; um redeploy não a migra."
            : "Estado operacional consultado sem carregar entradas, saídas ou sessões protegidas.";
  return {
    verified: valid, runId, status, errorCode,
    startedAt: valid ? date(run?.startedAt) : null,
    completedAt: valid ? date(run?.completedAt) : null,
    updatedAt: valid ? date(run?.updatedAt) : null,
    checkedAt: new Date(input.now ?? Date.now()).toISOString(),
    deploymentChanged, detail, inputOutputLoaded: false,
  };
}

/** Enrich display only. Checkpoints and status are never synthesized from Workflow. */
export function withWorkflowObservation<T extends Record<string, any>>(task: T, observation: WorkflowObservation, now = Date.now()) {
  const leaseTime = date(task.execution_lease_until);
  const leaseActive = leaseTime !== null && new Date(leaseTime).getTime() > now;
  const interrupted = observation.verified && ["failed", "cancelled"].includes(observation.status || "");
  const incomplete = observation.verified && observation.status === "completed" && task.status === "executing";
  const recoverableStatus = ["failed", "blocked"].includes(task.status) || task.status === "executing" && task.is_stale === true;
  const recoveryEligibility = {
    humanOnly: true,
    allowedNow: recoverableStatus && !leaseActive,
    leaseActive,
    leaseUntil: leaseTime,
    checkpointPreserved: true,
    reason: leaseActive ? "A reserva da fase ainda está ativa. Aguarde a expiração e confira os outputs."
      : task.status === "executing" && !task.is_stale ? "A janela segura inicial de execução ainda não expirou. Atualize o monitor."
        : recoverableStatus ? "Uma decisão humana persistida deve autorizar somente a fase pendente."
          : "Use a ação correspondente ao checkpoint atual; nenhuma retomada automática foi autorizada.",
  };
  if (task.status !== "executing" || !(interrupted || incomplete)) {
    return { ...task, workflow: observation, workflow_warning: interrupted ? observation.detail : null, recovery_eligibility: recoveryEligibility };
  }
  const message = `${observation.detail} ${recoveryEligibility.reason}`;
  return {
    ...task, workflow: observation, workflow_warning: message, recovery_eligibility: recoveryEligibility,
    next_action: message,
    attention: {
      kind: interrupted ? "failed" : "stale", severity: "critical", action: "refresh",
      title: interrupted ? "A execução durável foi interrompida" : "Confirmação de checkpoint pendente",
      message, step: task.current_step ?? null,
      attempts: task.attention?.attempts || 0,
      error: observation.errorCode,
    },
  };
}
