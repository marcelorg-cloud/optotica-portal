import type { SupabaseClient } from "@supabase/supabase-js";
import { NETWORK_NODES } from "./nodes.ts";
import { credentialPresent, guardianProviders, type ProviderEnvironment } from "./provider-registry.ts";

export type HealthState = "healthy" | "attention" | "unknown" | "unavailable" | "manual";
export type OrchestraCheck = {
  id: string;
  label: string;
  category: "provider" | "tool" | "runtime" | "security";
  state: HealthState;
  required: boolean;
  blocking: boolean;
  adapterConnected: boolean;
  configured: boolean | null;
  authenticated: boolean | null;
  authorized: boolean | null;
  operational: boolean | null;
  financial: "not_verified";
  account: string | null;
  detail: string;
  action: string | null;
  observedSuccessAt: string | null;
  requiresManualReview?: boolean;
};

export type CanvaHealthEvidence = {
  configured: boolean;
  clientId?: string | null;
  authenticated: boolean | null;
  authorized: boolean | null;
  operational: boolean | null;
  identity: { userId: string; teamId: string } | null;
  identityMatchesStored: boolean | null;
  tokenState: "absent" | "expired" | "current" | "invalid" | "not_checked";
  detail: string;
  action: string | null;
};

type ProviderEvidence = {
  authenticated: boolean | null;
  authorized: boolean | null;
  detail: string;
  action: string | null;
};

type RunEvidence = {
  node_id: string;
  adapter: string;
  status: string;
  updated_at: string;
};

type TaskEvidence = {
  id: string;
  status: string;
  updated_at: string;
  execution_lease_until?: string | null;
};

const AUTOMATIC_NODES = new Set(["A1", "A2", "A3", "A4", "A5", "F6"]);
const OPENAI_NODES = new Set(["A1", "A2", "A3", "A4"]);
const DEFAULT_PORTAL_ORIGIN = "https://app.optotica.com.br";

function currentCommit(env: ProviderEnvironment) {
  return [env.VERCEL_GIT_COMMIT_SHA?.trim(), env.REGENT_SOURCE_COMMIT?.trim()]
    .find((value): value is string => Boolean(value && /^[a-f0-9]{40}$/i.test(value))) || null;
}

export function portalOrigin(env: ProviderEnvironment = process.env) {
  try {
    const url = new URL(env.REGENT_PORTAL_ORIGIN?.trim() || DEFAULT_PORTAL_ORIGIN);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost" && env.NODE_ENV !== "production")) return null;
    return url.origin;
  } catch { return null; }
}

export function buildOrchestraHealth(input: {
  depth: "basic" | "deep";
  databaseOperational: boolean;
  databaseDetail?: string;
  requiredNodes?: string[];
  env?: ProviderEnvironment;
  generatedAt?: string;
  taskId?: string;
  tasks?: TaskEvidence[];
  recentRuns?: RunEvidence[];
  canvaEvidence?: CanvaHealthEvidence | null;
  openAIEvidence?: ProviderEvidence | null;
}) {
  const env = input.env || process.env;
  const requiredNodes = new Set(input.requiredNodes || []);
  const providers = guardianProviders(env);
  const openAIConfigured = credentialPresent("OPENAI_API_KEY", env);
  const workflowConfigured = credentialPresent("REGENT_WORKFLOW_SECRET", env);
  const generatedAt = input.generatedAt || new Date().toISOString();
  const recentSuccess = (node: string) => (input.recentRuns || [])
    .filter((run) => run.node_id === node && run.status === "succeeded")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.updated_at || null;

  const check = (value: Omit<OrchestraCheck, "financial" | "blocking" | "observedSuccessAt"> & { observedSuccessAt?: string | null }): OrchestraCheck => ({
    ...value,
    financial: "not_verified",
    observedSuccessAt: value.observedSuccessAt || null,
    blocking: value.required && (
      !value.adapterConnected || value.configured === false || value.authenticated === false ||
      value.authorized === false || value.operational === false
    ),
  });

  const checks: OrchestraCheck[] = [
    check({
      id: "runtime:supabase", label: "Supabase / estado persistente", category: "runtime",
      state: input.databaseOperational ? "healthy" : "attention", required: true,
      adapterConnected: true, configured: true, authenticated: input.databaseOperational,
      authorized: input.databaseOperational, operational: input.databaseOperational, account: null,
      detail: input.databaseDetail || "Consultas com sessão autenticada e filtro user_id; auditoria completa das políticas RLS não realizada.",
      action: input.databaseOperational ? null : "Revalidar sessão, projeto Supabase, grants e políticas RLS.",
    }),
    check({
      id: "provider:openai", label: providers[0].label, category: "provider",
      state: !openAIConfigured || input.openAIEvidence?.authenticated === false || input.openAIEvidence?.authorized === false ? "attention" : "unknown",
      required: [...requiredNodes].some((node) => OPENAI_NODES.has(node)), adapterConnected: true,
      configured: openAIConfigured, authenticated: input.openAIEvidence?.authenticated ?? null,
      authorized: input.openAIEvidence?.authorized ?? null, operational: null, account: null,
      detail: input.openAIEvidence?.detail || (openAIConfigured
        ? "Chave presente neste runtime. Presença não comprova autenticação, acesso ao modelo ou saldo."
        : "OPENAI_API_KEY ausente neste runtime; nenhuma conta Anthropic é necessária para corrigir a rota OpenAI."),
      action: input.openAIEvidence?.action || (!openAIConfigured ? "Configurar OPENAI_API_KEY no projeto Regente e publicar o runtime correto." : null),
      observedSuccessAt: recentSuccess("A4") || recentSuccess("A1") || recentSuccess("A2") || recentSuccess("A3"),
    }),
    check({
      id: "provider:claude", label: providers[1].label, category: "provider", state: "manual",
      required: false, adapterConnected: true, configured: true,
      authenticated: null, authorized: null, operational: null, account: null,
      detail: "Revisão externa por pacote versionado e importação humana. Conta Claude.ai e autoria do parecer não foram verificadas pelo Regente; nenhuma execução Anthropic é presumida.",
      action: "Baixar o pacote do guardião Claude e importar o parecer externo. A API Claude é opcional e não bloqueia a pipeline OpenAI.",
    }),
    check({
      id: "runtime:workflow", label: "Vercel Workflow / execução durável", category: "runtime",
      state: workflowConfigured ? "unknown" : "attention",
      required: [...requiredNodes].some((node) => node !== "A5"), adapterConnected: true,
      configured: workflowConfigured, authenticated: null, authorized: null, operational: null,
      account: null, detail: "Segredo e código durável inventariados; um teste de presença não prova queue, deployment, lease ou execução atual.",
      action: workflowConfigured ? null : "Configurar REGENT_WORKFLOW_SECRET no runtime que executa a missão e publicar.",
    }),
  ];

  for (const node of NETWORK_NODES) {
    const connected = AUTOMATIC_NODES.has(node.id);
    const isAI = OPENAI_NODES.has(node.id);
    const required = requiredNodes.has(node.id);
    if (isAI) {
      const provider = checks.find((item) => item.id === "provider:openai")!;
      checks.push(check({ ...provider, id: `node:${node.id}`, label: `${node.id} — ${node.role}`,
        category: "provider", required, observedSuccessAt: recentSuccess(node.id) }));
    } else if (node.id === "A5") {
      checks.push(check({ id: "node:A5", label: "A5 — preflight local", category: "runtime",
        state: input.databaseOperational ? "healthy" : "attention", required, adapterConnected: true,
        configured: true, authenticated: input.databaseOperational, authorized: input.databaseOperational,
        operational: input.databaseOperational, account: null,
        detail: "Preflight determinístico por leituras autenticadas, sem geração e sem segredo de provedor.", action: null,
        observedSuccessAt: recentSuccess(node.id) }));
    } else if (node.id === "F6") {
      const evidence = input.canvaEvidence;
      const configured = evidence?.configured ?? Boolean(portalOrigin(env));
      const failed = !configured || evidence?.operational === false || evidence?.identityMatchesStored === false;
      checks.push(check({ id: "node:F6", label: "F6 — Canva via Portal", category: "tool",
        state: failed ? "attention" : evidence?.operational === true ? "healthy" : "unknown",
        required, adapterConnected: true, configured, authenticated: evidence?.authenticated ?? null,
        authorized: evidence?.authorized ?? null, operational: evidence?.operational ?? null,
        account: evidence?.identity ? `${evidence.identity.userId} / equipe ${evidence.identity.teamId}` : null,
        detail: evidence?.detail || "Bridge conectado no código. OAuth, usuário, equipe e plano pertencem ao Portal; não são inferidos pela URL configurada.",
        action: evidence?.action || (!configured ? "Corrigir REGENT_PORTAL_ORIGIN para a origem HTTPS do Portal." : null),
        observedSuccessAt: recentSuccess(node.id) }));
    } else if (node.id === "A6") {
      checks.push(check({ id: "node:A6", label: "A6 — parecer externo Claude importado", category: "provider",
        state: "manual", required, adapterConnected: true, configured: true,
        authenticated: null, authorized: null, operational: null, account: null, requiresManualReview: true,
        detail: "Consome um parecer de origem humana declarada que corresponda à etapa e revisão atual. Não chama a API Claude e não comprova a identidade do provedor.",
        action: "Baixar o pacote Claude desta missão/etapa, revisar na sua conta e importar o parecer com a revisão correta; depois autorizar a fase." }));
    } else {
      checks.push(check({ id: `node:${node.id}`, label: `${node.id} — ${node.technology}`,
        category: node.type === "agent" ? "provider" : "tool", state: "unavailable",
        required, adapterConnected: false, configured: null, authenticated: null, authorized: null,
        operational: null, account: null,
        detail: "Ator do mapa arquitetural; não possui branch de execução automática no Regente. Configuração no Portal ou plugin deste chat não comprova adapter no runtime.",
        action: required ? "Revisar a fase e substituir por um adapter disponível, implementar a integração ou adiar explicitamente se for opcional."
            : "Nenhuma ação obrigatória para esta missão; integração automática não implementada.",
        observedSuccessAt: recentSuccess(node.id) }));
    }
  }

  for (const node of requiredNodes) {
    if (NETWORK_NODES.some((item) => item.id === node)) continue;
    checks.push(check({ id: `node:${node}`, label: `${node} — nó não registrado`, category: "tool",
      state: "unavailable", required: true, adapterConnected: false, configured: null,
      authenticated: null, authorized: null, operational: null, account: null,
      detail: "A missão referencia um nó que não existe no registro desta versão.",
      action: "Revisar a fase e indicar um nó registrado com adapter implementado." }));
  }

  const nodes = NETWORK_NODES.map((node) => {
    const evidence = checks.find((item) => item.id === `node:${node.id}`)!;
    const adapter = OPENAI_NODES.has(node.id) ? node.id === "A4" ? "openai_agents_independent_review" : "openai_agents"
      : node.id === "A5" ? "local_recovery_preflight" : node.id === "A6" ? "human_import"
        : node.id === "F6" ? "canva_portal_bridge" : "not_implemented";
    return { ...node, label: node.technology, adapter, architecturalStatus: node.status, status: evidence.state,
      adapterConnected: evidence.adapterConnected, configured: evidence.configured,
      operational: evidence.operational, required: evidence.required, blocking: evidence.blocking,
      requiresManualReview: evidence.requiresManualReview || false,
      observedSuccessAt: evidence.observedSuccessAt,
      executionScope: node.id === "A6" ? "external_guardian" : AUTOMATIC_NODES.has(node.id) ? "runtime" : "architectural_only" };
  });
  const links = [
    ...["A1", "A2", "A3", "A4"].map((id) => ({ id: `regente-${id}`, from: "Regente", to: id,
      transport: "openai_agents_sdk", adapterConnected: true, accountSource: "OPENAI_API_KEY@Regente",
      state: checks.find((item) => item.id === `node:${id}`)!.state })),
    { id: "regente-preflight", from: "Regente", to: "A5", transport: "local_authenticated_reads", adapterConnected: true, accountSource: "sessão Supabase do Master", state: checks[0].state },
    { id: "preflight-database", from: "A5", to: "F3", transport: "supabase_rls", adapterConnected: true, accountSource: "sessão Supabase do Master", state: checks[0].state },
    { id: "canva-bridge", from: "Regente", to: "F6", transport: "single_use_tool_run", adapterConnected: true, accountSource: "Canva OAuth@Portal", state: checks.find((item) => item.id === "node:F6")!.state },
    { id: "canva-shared-account", from: "F6", to: "F5", transport: "shared_portal_connection", adapterConnected: true, accountSource: "canva_connections.user_id", state: checks.find((item) => item.id === "node:F6")!.state },
    { id: "durable-workflow", from: "Regente", to: "Vercel Workflow", transport: "sealed_session_and_execution_lease", adapterConnected: true, accountSource: "sessão Master + segredo do workflow", state: workflowConfigured ? "unknown" : "attention" },
    { id: "github-deployment", from: "F1", to: "F2", transport: "git_push_deployment", adapterConnected: true, accountSource: "configuração Git/Vercel não consultada", state: "unknown" },
    { id: "claude-external-review", from: "Guardião Claude", to: "Regente", transport: "manual_packet_and_human_import", adapterConnected: true, accountSource: "origem declarada pelo operador; não verificada", state: "manual" },
    ...NETWORK_NODES.filter((node) => !AUTOMATIC_NODES.has(node.id) && node.id !== "A6").map((node) => ({
      id: `unavailable-${node.id}`, from: "Regente", to: node.id, transport: "not_implemented",
      adapterConnected: false, accountSource: "não verificável pelo runtime", state: "unavailable" })),
  ];
  const tasks = (input.tasks || []).map((task) => ({ id: task.id, status: task.status, updatedAt: task.updated_at,
    leaseExpired: task.status === "executing" && Boolean(task.execution_lease_until) &&
      new Date(task.execution_lease_until!).getTime() < new Date(generatedAt).getTime() }));
  return {
    version: "0.7.0", sourceCommit: currentCommit(env), depth: input.depth, generatedAt,
    taskId: input.taskId || null, requiredNodes: [...requiredNodes],
    summary: { nodes: nodes.length, links: links.length, checks: checks.length,
      attention: checks.filter((item) => item.state === "attention" || (item.required && item.state === "unavailable")).length,
      unknown: checks.filter((item) => item.state === "unknown").length,
      healthy: checks.filter((item) => item.state === "healthy").length,
      unavailable: checks.filter((item) => item.state === "unavailable").length,
      blockingCount: checks.filter((item) => item.blocking).length,
      expiredExecutions: tasks.filter((task) => task.leaseExpired).length },
    checks, nodes, links, providers, tasks, canva: input.canvaEvidence || null,
    safety: { secretValuesIncluded: false, generativeCallsPerformed: false, paidProbesPerformed: false, automaticCredentialChanges: false },
    limitations: [
      "Créditos, faturamento, plano Pro e bloqueios financeiros são não verificáveis sem fonte própria; chave presente não significa saldo ou modelo autorizado.",
      "Sucessos anteriores são evidência histórica com horário, não garantia de que a conexão atual continua operacional.",
      "Uma consulta autenticada usa RLS, mas não comprova isoladamente a correção de todas as políticas de segurança.",
      "O afinamento profundo só consulta banco, lista de modelos e identidade Canva; não cria designs, não publica anúncios, não renova OAuth nem realiza geração paga.",
      "Claude interativo é uma revisão humana importada, não uma chamada automática à Anthropic. DeepSeek fica reservado para 0.8, fora da rede ativa.",
    ],
  };
}

export type OrchestraHealthReport = ReturnType<typeof buildOrchestraHealth>;

export class OrchestraReadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function probeOpenAI(fetchImpl: typeof fetch, env: ProviderEnvironment): Promise<ProviderEvidence | null> {
  if (!credentialPresent("OPENAI_API_KEY", env)) return null;
  try {
    const response = await fetchImpl("https://api.openai.com/v1/models", {
      method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000),
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` },
    });
    if (response.ok) {
      const body = await response.json().catch(() => null);
      if (!Array.isArray(body?.data)) throw new Error("invalid_model_list");
      return { authenticated: true, authorized: true,
        detail: "Lista de modelos lida com autenticação no runtime atual. Isso não valida uma geração, o acesso ao modelo selecionado nem o saldo.", action: null };
    }
    return { authenticated: response.status === 401 ? false : null, authorized: response.status === 403 ? false : null,
      detail: `Leitura OpenAI não concluída (HTTP ${response.status}); resposta do provedor não reproduzida para proteger credenciais.`,
      action: response.status === 401 || response.status === 403 ? "Revalidar chave/projeto OpenAI do runtime Regente." : "Repetir o afinamento posteriormente; não repetir geração às cegas." };
  } catch {
    return { authenticated: null, authorized: null, detail: "Endpoint de modelos OpenAI não pôde ser verificado (rede, timeout ou resposta inválida).",
      action: "Conferir disponibilidade da API e repetir o afinamento; não presumir falha de billing." };
  }
}

async function probeCanva(fetchImpl: typeof fetch, env: ProviderEnvironment, accessToken?: string): Promise<CanvaHealthEvidence | null> {
  const origin = portalOrigin(env);
  if (!origin || !accessToken) return null;
  try {
    const response = await fetchImpl(`${origin}/api/internal/regente/canva/health`, {
      method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) return { configured: true, authenticated: null, authorized: null, operational: null,
      identity: null, identityMatchesStored: null, tokenState: "not_checked",
      detail: `Bridge de diagnóstico Canva não pôde ser consultado (HTTP ${response.status}). Isso não é prova de OAuth Canva inválido.`,
      action: "Verificar deployment do Portal, sessão Master e acesso à rota de diagnóstico; depois conferir a conexão Canva." };
    const body = await response.json().catch(() => null);
    const evidence = body?.canva;
    if (!evidence || typeof evidence.configured !== "boolean") throw new Error("invalid_canva_report");
    // Return only the fixed non-secret contract, never arbitrary bridge output.
    const booleanOrNull = (value: unknown) => typeof value === "boolean" ? value : null;
    const identity = typeof evidence.identity?.userId === "string" && typeof evidence.identity?.teamId === "string"
      ? { userId: evidence.identity.userId.slice(0, 128), teamId: evidence.identity.teamId.slice(0, 128) } : null;
    const tokenState = ["absent", "expired", "current", "invalid", "not_checked"].includes(evidence.tokenState)
      ? evidence.tokenState as CanvaHealthEvidence["tokenState"] : "not_checked";
    return { configured: evidence.configured,
      clientId: typeof evidence.clientId === "string" && /^OC[A-Za-z0-9_-]{4,125}$/.test(evidence.clientId) ? evidence.clientId : null,
      authenticated: booleanOrNull(evidence.authenticated),
      authorized: booleanOrNull(evidence.authorized), operational: booleanOrNull(evidence.operational), identity,
      identityMatchesStored: booleanOrNull(evidence.identityMatchesStored), tokenState,
      detail: typeof evidence.detail === "string" ? evidence.detail.slice(0, 1200) : "Verificação de identidade do Portal recebida.",
      action: typeof evidence.action === "string" ? evidence.action.slice(0, 800) : null };
  } catch {
    return { configured: true, authenticated: null, authorized: null, operational: null, identity: null,
      identityMatchesStored: null, tokenState: "not_checked", detail: "Bridge Canva sem resposta de diagnóstico válida; OAuth não foi comprovado.",
      action: "Conferir acesso e deployment do Portal, sem alterar tokens ou executar designs para testar." };
  }
}

export async function collectOrchestraHealth(input: {
  supabase: SupabaseClient;
  userId: string;
  depth: "basic" | "deep";
  requiredNodes?: string[];
  taskId?: string;
  accessToken?: string;
  env?: ProviderEnvironment;
  fetchImpl?: typeof fetch;
}): Promise<OrchestraHealthReport> {
  const env = input.env || process.env;
  const countResult = await input.supabase.from("regent_tasks")
    .select("id", { count: "exact", head: true }).eq("user_id", input.userId);
  if (countResult.error) throw new OrchestraReadError("orchestra_tasks_read_failed", "A leitura autenticada do banco falhou; diagnóstico não aprovado.");

  let requiredNodes = input.requiredNodes || [];
  if (input.taskId) {
    const taskResult = await input.supabase.from("regent_tasks").select("id,pipeline")
      .eq("id", input.taskId).eq("user_id", input.userId).maybeSingle();
    if (taskResult.error) throw new OrchestraReadError("orchestra_task_read_failed", "Não foi possível ler a missão autorizada.");
    if (!taskResult.data) throw new OrchestraReadError("task_not_found", "Missão não encontrada para este operador.");
    if (!input.requiredNodes && Array.isArray(taskResult.data.pipeline)) {
      requiredNodes = [...new Set(taskResult.data.pipeline.flatMap((step: { nodes?: unknown }) =>
        Array.isArray(step?.nodes) ? step.nodes.filter((node): node is string => typeof node === "string") : []))] as string[];
    }
  }

  let tasks: TaskEvidence[] = [];
  let recentRuns: RunEvidence[] = [];
  let canvaEvidence: CanvaHealthEvidence | null = null;
  let openAIEvidence: ProviderEvidence | null = null;
  if (input.depth === "deep") {
    let tasksQuery = input.supabase.from("regent_tasks")
      .select("id,status,updated_at,execution_lease_until").eq("user_id", input.userId)
      .order("updated_at", { ascending: false }).limit(100);
    let runsQuery = input.supabase.from("regent_tool_runs")
      .select("node_id,adapter,status,updated_at").eq("user_id", input.userId)
      .order("updated_at", { ascending: false }).limit(250);
    if (input.taskId) { tasksQuery = tasksQuery.eq("id", input.taskId); runsQuery = runsQuery.eq("task_id", input.taskId); }
    const [taskResult, runResult] = await Promise.all([tasksQuery, runsQuery]);
    if (taskResult.error || runResult.error) throw new OrchestraReadError("orchestra_evidence_read_failed", "Falha nas consultas de runtime; não é seguro aprovar o diagnóstico.");
    tasks = taskResult.data || [];
    recentRuns = runResult.data || [];
    [canvaEvidence, openAIEvidence] = await Promise.all([
      probeCanva(input.fetchImpl || fetch, env, input.accessToken),
      probeOpenAI(input.fetchImpl || fetch, env),
    ]);
  }
  return buildOrchestraHealth({ depth: input.depth, databaseOperational: true,
    databaseDetail: `Leitura com sessão autenticada e filtro user_id: ${countResult.count || 0} missões visíveis. Não substitui auditoria completa das políticas RLS.`,
    requiredNodes, env, taskId: input.taskId, tasks, recentRuns, canvaEvidence, openAIEvidence });
}
