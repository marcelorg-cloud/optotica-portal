import type { PipelineStep } from "./adapters";

export const REGENT_VERSION = "0.7.0";

export type PhaseState = {
  step_number: number;
  status: string;
  depends_on?: number[] | null;
  revision?: number;
  artifact?: unknown;
  validated_at?: string | null;
};

export function nextPhase(steps: PhaseState[]) {
  const ordered = [...steps].sort((a, b) => a.step_number - b.step_number);
  const next = ordered.find((step) => !["succeeded", "skipped"].includes(step.status));
  if (!next) return { step: null, unresolved: [] as number[] };
  const completed = new Set(ordered.filter((step) => ["succeeded", "skipped"].includes(step.status)).map((step) => step.step_number));
  return { step: next, unresolved: (next.depends_on || []).filter((step) => !completed.has(step)) };
}

/** Context follows declared data edges, so redo invalidates exactly the actual consumers. */
export function dependencyArtifacts(steps: Array<PhaseState & { node_ids?: string[] }>, target: number) {
  const needed = new Set<number>();
  const visit = (number: number) => {
    for (const dependency of steps.find((step) => step.step_number === number)?.depends_on || []) {
      if (dependency === target || needed.has(dependency)) continue;
      needed.add(dependency); visit(dependency);
    }
  };
  visit(target);
  return steps.filter((step) => needed.has(step.step_number) && step.status === "succeeded" && step.artifact != null)
    .sort((a, b) => a.step_number - b.step_number)
    .map((step) => ({ step: step.step_number, node: step.node_ids?.[0] || "unknown", output: step.artifact }));
}

/** Every new mission has a deterministic local preflight; never rewrite existing missions' IDs. */
export function normalizeNewPipeline(pipeline: PipelineStep[]): PipelineStep[] {
  if (!pipeline.length) return [];
  const ordered = [...pipeline].sort((a, b) => a.step - b.step);
  const ids = ordered.map((step) => step.step);
  if (new Set(ids).size !== ids.length) throw new Error("O plano contém etapas duplicadas.");
  const hasPreflight = ordered[0].nodes[0] === "A5";
  const mapping = new Map(ids.map((id, index) => [id, index + (hasPreflight ? 1 : 2)]));
  const normalized = ordered.map((step, index) => {
    const declared = step.dependsOn ?? (index ? [ordered[index - 1].step] : []);
    if (declared.some((dep) => !mapping.has(dep) || dep >= step.step)) {
      throw new Error("Dependência inexistente ou cíclica no plano. Revise a pipeline antes de executar.");
    }
    const dependencies = declared.map((dep) => mapping.get(dep)!);
    return { ...step, step: mapping.get(step.step)!, dependsOn: !hasPreflight && !dependencies.length ? [1] : dependencies, checkpoint: true, requiresApproval: true };
  });
  const preflight: PipelineStep = {
    step: 1, role: "reference", nodes: ["A5"],
    action: "Afinar a orquestra: verificar estado, dependências, adapters e configuração sem chamadas generativas.",
    input: "Estado persistente desta missão e configuração booleana do runtime autenticado.",
    expectedOutput: "Relatório de afinamento básico, capacidades reais, limites não verificáveis e primeira fase elegível.",
    executionState: "ready", requiresApproval: true, dependsOn: [], checkpoint: true,
  };
  return hasPreflight ? [{ ...normalized[0], ...preflight }, ...normalized.slice(1)] : [preflight, ...normalized];
}

export function buildPhaseReport(input: {
  step: PipelineStep;
  revision: number;
  output: unknown;
  states: PhaseState[];
  completedAt?: string;
}) {
  const states = input.states.map((state) => state.step_number === input.step.step ? { ...state, status: "succeeded" } : state);
  const next = nextPhase(states);
  const output = input.output as { result?: unknown; notes?: unknown; deferred?: unknown } | null;
  const result = typeof output?.result === "string" ? output.result : "";
  return {
    kind: "phase_checkpoint", version: REGENT_VERSION,
    step: input.step.step, revision: input.revision, title: input.step.action,
    summary: output?.deferred ? "Fase adiada explicitamente, sem execução externa." : result ? result.slice(0, 1600) : "Output persistido. Revise o conteúdo e os limites antes de continuar.",
    output: input.output,
    completedAt: input.completedAt || new Date().toISOString(),
    nextStep: next.step?.step_number ?? null,
    unresolvedDependencies: next.unresolved,
    final: next.step === null,
    limitations: [
      "A conclusão desta fase não significa aprovação humana nem conclusão da missão.",
      "Custo real e saldo não verificáveis sem evidência de faturamento.",
      ...(Array.isArray(output?.notes) ? output.notes.filter((note): note is string => typeof note === "string") : []),
    ],
  };
}

export function redactSecrets(value: string, env: Record<string, string | undefined> = process.env) {
  let text = value;
  for (const [name, secret] of Object.entries(env)) {
    if (/(?:SECRET|TOKEN|API_KEY|PASSWORD|PRIVATE_KEY)/i.test(name) && secret && secret.length >= 8) {
      text = text.split(secret).join("[segredo ocultado]");
    }
  }
  return text.replace(/\b(?:sk-|sk_|eyJ)[A-Za-z0-9_.-]{12,}/g, "[segredo ocultado]")
    .replace(/\b(?:cnvca|gh[pousr]_)[A-Za-z0-9_-]{8,}/g, "[segredo ocultado]")
    .replace(/([?&](?:token|client_secret|api_key|access_token|refresh_token)=)[^&\s]+/gi, "$1[segredo ocultado]")
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer [segredo ocultado]");
}

export function failureDisposition(error: unknown, node: string, mode?: string) {
  const raw = error instanceof Error ? error.message : String(error || "Falha sem detalhes.");
  const message = redactSecrets(raw).slice(0, 2200);
  const status = Number((error as { status?: unknown } | null)?.status || 0);
  const code = String((error as { code?: unknown } | null)?.code || "");
  if (/insufficient_quota|billing|credit|saldo|payment/i.test(raw + code)) {
    return { message, kind: "billing", retry: false, action: "Conferir faturamento e limites do provedor; depois autorizar a retomada desta fase." };
  }
  if ([401, 403].includes(status) || /OAuth|invalid_grant|invalid_scope|credencial|não configurad|unauthorized|forbidden|permiss[ãa]o|sem acesso/i.test(raw)) {
    return { message, kind: "configuration", retry: false, action: node === "F6" ? "No Portal, reconecte a conta Canva correta e confira as permissões REST API. Faça o afinamento profundo e retome esta fase." : "Confira a configuração do adapter no ambiente de produção. Não crie uma conta Anthropic para desbloquear nós OpenAI." };
  }
  if (/adapter|ainda não conectado|dependências|referências|precisa declarar|múltiplos|inválid|not found|422/i.test(raw) || status === 422) {
    return { message, kind: "deterministic", retry: false, action: "Revisar a entrada ou conectar o adapter indicado. Use Refazer com orientação, preservando os outputs anteriores." };
  }
  if (node === "F6" && mode !== "inspect") {
    return { message, kind: "external_effect_unknown", retry: false, action: "Verificar os designs e o run original no Canva antes de refazer. Um erro de transporte pode ocorrer após a criação; não repetir automaticamente." };
  }
  const transient = [408, 429, 500, 502, 503, 504].includes(status) || /timeout|timed out|ECONNRESET|ETIMEDOUT|rate.?limit|HTTP 50[234]|fetch failed|temporar/i.test(raw);
  return { message, kind: transient ? "transient" : "unknown", retry: transient && (["A1", "A2", "A3", "A4"].includes(node) || node === "F6" && mode === "inspect"), action: transient ? "Repetir apenas esta fase dentro do limite autorizado; efeitos externos confirmados serão preservados." : "Analisar o diagnóstico e autorizar a retomada ou refazer apenas esta fase com nova orientação." };
}
