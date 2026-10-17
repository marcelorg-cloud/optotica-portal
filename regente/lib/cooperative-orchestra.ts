/**
 * Regente v0.8 — cooperative coordination contract (pure, no IO).
 * Organizers coordinate the network; they do not manufacture mission outputs.
 * This is deliberately separate from the v0.7 execution engine.
 */
export const COOPERATIVE_VERSION = "0.8.0-foundation";
export const COOPERATION_CHARTER = [
  "A obra e seus objetivos orientam os contornos, sem dispensar critérios obrigatórios.",
  "Coordenação distribuída: pareceres independentes, decisões rastreáveis.",
  "Dissonância fundamentada é preservada; falsidade ou conflito de segurança bloqueia.",
  "Agentes organizadores não executam ferramentas com efeitos externos.",
  "Somente evidências e aprovação válida autorizam execução ou conclusão.",
  "Falha local não cancela trabalho independente; não simular entregas ausentes.",
  "Eficiência: menor formação competente, rodadas delimitadas, sem loops pagos.",
] as const;

export const COORDINATOR_ROLES = [
  // Stable legacy ID preserves peer references; the display name is not a new agent or permission.
  { id: "direcao_musical", name: "Orientação de Coerência", responsibility: "Propósito e alinhamento institucional", specialty: "governance" },
  { id: "regente", name: "Regente", responsibility: "Coerência do conjunto e condução cooperativa", specialty: "coherence" },
  { id: "compositor", name: "Compositor", responsibility: "Concepção da solução, sem implementá-la", specialty: "design" },
  { id: "orquestrador", name: "Orquestrador", responsibility: "Dependências, concorrência e alternativas", specialty: "scheduling" },
  { id: "spalla", name: "Spalla", responsibility: "Afinação, disponibilidade e conexão", specialty: "readiness" },
  { id: "bibliotecario", name: "Bibliotecário", responsibility: "Fontes, versões e contexto autorizado", specialty: "knowledge" },
  { id: "ensaiador", name: "Ensaiador", responsibility: "Plano de ensaios sem efeitos externos", specialty: "testing" },
  { id: "auditor_harmonia", name: "Auditor de Harmonia", responsibility: "Consonância, dissonância e evidência", specialty: "quality" },
] as const;
export type CoordinatorId = (typeof COORDINATOR_ROLES)[number]["id"];
export type WorkState = "pending" | "running" | "succeeded" | "blocked" | "failed" | "deferred";
export type ExternalEffect = "read" | "write" | "irreversible";
export type WorkItem = {
  id: string;
  description: string;
  dependsOn: string[];
  state: WorkState;
  priority: number;
  effect: ExternalEffect;
  // Eligibility only. The v0.7 Master/RLS gate remains authoritative.
  approved: boolean;
  optional: boolean;
};
export type CoordinationNote = {
  organizer: CoordinatorId;
  scoreVersion: string;
  missionId: string;
  focus: string;
  evidence: string[];
  conclusion: string;
  disagreement?: string;
};
export type KnowledgeLayer = "universal" | "instituto" | "obra" | "subprojeto" | "missao" | "execucao";
export const KNOWLEDGE_LAYERS: KnowledgeLayer[] = ["universal","instituto","obra","subprojeto","missao","execucao"];

function graphIndex(items: WorkItem[]) {
  const byId = new Map<string, WorkItem>();
  if (items.length > 150) throw new Error("graph_limit_exceeded");
  for (const item of items) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || byId.has(item.id)) throw new Error("invalid_or_duplicate_work_id");
    if (!Number.isFinite(item.priority) || item.priority < 0 || item.priority > 100) throw new Error("invalid_priority");
    byId.set(item.id, item);
  }
  for (const item of items) {
    if (new Set(item.dependsOn).size !== item.dependsOn.length || item.dependsOn.some(dep=>!byId.has(dep) || dep===item.id)) {
      throw new Error("invalid_dependency");
    }
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("cyclic_dependency");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)!.dependsOn) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  for (const item of items) visit(item.id);
  return byId;
}

/** One possible concurrent wave; no task is executed by this function. */
export function nextCoordinationWave(items: WorkItem[], limit = 3) {
  const index = graphIndex(items);
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error("invalid_concurrency_limit");
  const running = items.filter(item => item.state === "running").length;
  const slots = Math.max(0, limit - running);
  const blockedBy: Record<string,string[]> = {};
  const waitingApproval: string[] = [];
  const eligible: WorkItem[] = [];
  for (const item of items) {
    if (item.state !== "pending") continue;
    const missing = item.dependsOn.filter(dep => index.get(dep)!.state !== "succeeded");
    if (missing.length) { blockedBy[item.id] = missing; continue; }
    if (item.effect !== "read" && !item.approved) { waitingApproval.push(item.id); continue; }
    eligible.push(item);
  }
  eligible.sort((a,b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return {
    runnable: eligible.slice(0,slots).map(x=>x.id),
    waitingApproval, blockedBy,
    running: items.filter(x=>x.state==="running").map(x=>x.id),
    availableSlots: slots,
    // Scheduler advice is NOT permission to bypass the existing Master gate.
    requiresRuntimeAuthorization: true as const,
  };
}

/** A block may be bypassed only by substituting a method, never a required outcome. */
export function assessDetour(items: WorkItem[], blockedId: string, alternative?: { id: string; sameOutcome: boolean; approved: boolean }) {
  const index = graphIndex(items);
  const target = index.get(blockedId);
  if (!target || !["blocked","failed"].includes(target.state)) throw new Error("blocked_work_not_found");
  const dependent = items.filter(item => item.dependsOn.includes(blockedId)).map(item=>item.id);
  const independent = items.filter(item =>
    item.state === "pending" && item.id !== blockedId && !item.dependsOn.includes(blockedId) &&
    item.dependsOn.every(dep => index.get(dep)!.state === "succeeded")
  ).map(item=>item.id);
  const validAlternative = !!alternative && alternative.sameOutcome && alternative.approved &&
    alternative.id !== blockedId && !index.has(alternative.id);
  return {
    blockedId, dependent, independent,
    disposition: validAlternative ? "requires_plan_revision" as const :
      target.optional && dependent.length===0 ? "defer_with_human_record" as const : "needs_human_or_alternative" as const,
    safeToAutoSkip: false as const,
    // No authorization or new edge is silently written.
    nextAction: validAlternative ? "Revisar a partitura, validar o substituto e autorizar a execução." :
      "Preservar o bloqueio e seus dependentes; continuar apenas atividades independentes.",
  };
}

export function classifyHarmony(notes: CoordinationNote[]) {
  if (!notes.length) return { state: "unverified" as const, reasons: ["Nenhum parecer recebido."] };
  const missionId=notes[0].missionId, version=notes[0].scoreVersion;
  if (notes.some(n=>!n.missionId || n.missionId!==missionId || n.scoreVersion!==version)) {
    return { state: "critical_conflict" as const, reasons: ["Partituras ou missões divergentes."] };
  }
  if (new Set(notes.map(n=>n.organizer)).size!==notes.length) {
    return { state: "critical_conflict" as const, reasons: ["Papéis duplicados no mesmo conjunto."] };
  }
  if (notes.some(n=>!n.evidence.length)) return { state: "unverified" as const, reasons: ["Há parecer sem evidência."] };
  const dissent=notes.filter(n=>n.disagreement?.trim());
  if (dissent.length) return { state: "productive_dissonance" as const, reasons: dissent.map(n=>n.disagreement!.trim()) };
  return { state: "consonant" as const, reasons: ["Pareceres com mesma partitura e evidências; validação externa ainda necessária."] };
}
