"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ModalFrame } from "./components/modal-frame";
import {
  SETTLED_TASK_STATUSES, controlRevisionOf, engineVersionOf, errorMessage, missionPlans,
  needsRecovery, outputText, phaseReportOf, roleLabel, runtimeCounts, runtimeFromTask,
  safeOutputLinks, stepStatusLabel, taskStatusLabel, taskUpdatedLabel,
  type ChatMessage, type PlanPayload, type RuntimeStep,
} from "./regente-ui-state";

type Session = {
  id: string;
  title: string;
  budget_tier: "minimal" | "controlled" | "flexible";
  created_at: string;
  updated_at: string;
};

type OutputItem = {
  id: string;
  step: number;
  revision?: number;
  node: string;
  kind: string;
  source: string;
  status: string;
  createdAt?: string | null;
  content: string;
  links: string[];
  filename?: string;
  downloadUrl?: string;
  truncated?: boolean;
};

type OutputTaskSummary = {
  completedSteps: number;
  failedSteps: number;
  totalSteps: number;
  outputCount: number;
};

type HealthCheck = {
  id: string;
  label: string;
  category?: string;
  state: string;
  adapterConnected?: boolean;
  required?: boolean;
  blocking?: boolean;
  configured: boolean | null;
  authenticated?: boolean | null;
  authorized?: boolean | null;
  operational: boolean | null;
  financial?: string;
  account: string | null;
  detail: string;
  action: string | null;
};

type HealthReport = {
  id?: string;
  version?: string;
  depth: string;
  generatedAt?: string;
  persistedAt?: string;
  summary?: { nodes?: number; checks?: number; attention?: number; unknown?: number; healthy?: number };
  checks?: HealthCheck[];
  nodes?: { id: string; label?: string; name?: string; technology?: string; type?: string; status?: string; role?: string; adapter?: string; configured?: boolean | null; operational?: boolean | null; adapterConnected?: boolean }[];
  links?: { id?: string; from?: string; to?: string; state?: string; detail?: string; action?: string; transport?: string; accountSource?: string }[];
  limitations?: string[];
};

type Decision = "execute" | "partial" | "continue" | "redo" | "skip" | "reject" | "revise" | "recover";
type DecisionDialog = { taskId: string; title: string; decision: Decision; step?: number };
type PhasePatch = { nodes: string[]; canvaMode?: "create" | "inspect"; canvaSourceRunIds?: string[]; canvaDesignIds?: string[] };
const PHASE_EXECUTORS = ["A1", "A2", "A3", "A4", "A5", "A6", "F6", "F9"];
type GuardianPacketMetadata = {
  provider: "openai" | "claude";
  taskId: string | null;
  packetId?: string;
  sourceCommit?: string | null;
  generatedAt?: string;
  includedFiles?: number;
  expectedFiles?: number;
  completeRelevantSnapshot?: boolean;
  stepRevisions: Record<number, number>;
};
type MonitorSize = "minimized" | "normal" | "expanded";
const MONITOR_STORAGE_KEY = "regente.monitor.v07";

async function readApiResponse(response: Response) {
  const raw = await response.text();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return { message: `Resposta inesperada do servidor (HTTP ${response.status}).`, raw: raw.slice(0, 300) }; }
}

function downloadText(content: string, filename: string, mime = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderMessageContent(content: string) {
  return content.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="message-link">{part}</a>
    ) : <span key={index}>{part}</span>,
  );
}

function healthStateLabel(state?: string) {
  return ({ healthy: "Verificado", attention: "Ação necessária", unknown: "Não verificado", planned: "Planejado", unavailable: "Indisponível", manual: "Revisão humana externa" } as Record<string, string>)[state || ""] || "Não verificado";
}

function checkedBoolean(value: boolean | null | undefined) {
  return value === true ? "Sim" : value === false ? "Não" : "Não verificado";
}

export function RegenteClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [budgetTier, setBudgetTier] = useState<Session["budget_tier"]>("minimal");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [decisionLoading, setDecisionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [monitorSize, setMonitorSize] = useState<MonitorSize>("normal");
  const [monitoredTaskId, setMonitoredTaskId] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [release, setRelease] = useState<{ version?: string; commit?: string; gitCommit?: string } | null>(null);
  const [decisionDialog, setDecisionDialog] = useState<DecisionDialog | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [phasePatchEnabled, setPhasePatchEnabled] = useState(false);
  const [phasePatchNode, setPhasePatchNode] = useState("A1");
  const [phasePatchCanvaMode, setPhasePatchCanvaMode] = useState<"create" | "inspect">("create");
  const [phasePatchSourceRuns, setPhasePatchSourceRuns] = useState("");
  const [phasePatchDesignIds, setPhasePatchDesignIds] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [outputsTaskId, setOutputsTaskId] = useState<string | null>(null);
  const [outputsTitle, setOutputsTitle] = useState("");
  const [outputsItems, setOutputsItems] = useState<OutputItem[]>([]);
  const [outputsLoading, setOutputsLoading] = useState(false);
  const [outputsError, setOutputsError] = useState("");
  const [outputsTaskSummary, setOutputsTaskSummary] = useState<OutputTaskSummary | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState<"basic" | "deep" | "load" | null>(null);
  const [healthError, setHealthError] = useState("");
  const [guardianLoading, setGuardianLoading] = useState(false);
  const [guardianPacket, setGuardianPacket] = useState<GuardianPacketMetadata | null>(null);
  const [guardianReviewTaskId, setGuardianReviewTaskId] = useState<string | null>(null);
  const [guardianReviewStep, setGuardianReviewStep] = useState<number | null>(null);
  const [guardianReview, setGuardianReview] = useState("");
  const [guardianManualSource, setGuardianManualSource] = useState(false);
  const [guardianImportLoading, setGuardianImportLoading] = useState(false);
  const [guardianImportError, setGuardianImportError] = useState("");
  const [guardianImportNotice, setGuardianImportNotice] = useState("");
  const streamRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowBottomRef = useRef(true);
  const activeSessionRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  const sessionRequestRef = useRef<AbortController | null>(null);
  const outputRequestRef = useRef<AbortController | null>(null);
  const pollingTasksRef = useRef<Map<string, AbortController>>(new Map());
  const mountedRef = useRef(true);
  messagesRef.current = messages;

  useEffect(() => {
    mountedRef.current = true;
    void loadSessions();
    try {
      const saved = JSON.parse(localStorage.getItem(MONITOR_STORAGE_KEY) || "null");
      if (saved?.version === 1 && ["minimized", "normal", "expanded"].includes(saved.size)) setMonitorSize(saved.size);
    } catch { /* Browser storage can be disabled. Monitoring still works. */ }
    const controller = new AbortController();
    void fetch("/api/version", { cache: "no-store", signal: controller.signal })
      .then(readApiResponse).then((data) => { if (!controller.signal.aborted) setRelease(data); })
      .catch(() => { /* The server version is shown as unconfirmed if unreachable. */ });
    return () => {
      mountedRef.current = false;
      controller.abort();
      sessionRequestRef.current?.abort();
      outputRequestRef.current?.abort();
      for (const polling of pollingTasksRef.current.values()) polling.abort();
      pollingTasksRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (streamRef.current && shouldFollowBottomRef.current) {
      streamRef.current.scrollTo({ top: streamRef.current.scrollHeight, behavior: "auto" });
    }
  }, [messages.length, loading, sessionId]);

  function changeMonitorSize(size: MonitorSize) {
    setMonitorSize(size);
    try { localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify({ version: 1, size })); }
    catch { /* Nonessential preference; do not block execution. */ }
  }

  function stopPolling() {
    for (const controller of pollingTasksRef.current.values()) controller.abort();
    pollingTasksRef.current.clear();
  }

  function trackScroll() {
    const stream = streamRef.current;
    if (stream) shouldFollowBottomRef.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
  }

  function goToMessageEdge(edge: "top" | "bottom") {
    shouldFollowBottomRef.current = edge === "bottom";
    streamRef.current?.scrollTo({ top: edge === "top" ? 0 : streamRef.current.scrollHeight, behavior: "smooth" });
  }

  async function loadSessions(selectLatest = true) {
    setLoadingHistory(true);
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "Não foi possível carregar as conversas.");
      if (!mountedRef.current) return;
      const list = (data.sessions || []) as Session[];
      setSessions(list);
      if (selectLatest && !activeSessionRef.current && list.length) await openSession(list[0].id);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Não foi possível carregar as conversas.");
    } finally { if (mountedRef.current) setLoadingHistory(false); }
  }

  async function openSession(id: string) {
    const previousSession = activeSessionRef.current;
    sessionRequestRef.current?.abort();
    const controller = new AbortController();
    sessionRequestRef.current = controller;
    if (previousSession !== id) {
      stopPolling();
      outputRequestRef.current?.abort();
      setMessages([]);
      setMonitoredTaskId(null);
      setOutputsTaskId(null);
      setDecisionDialog(null);
      setHealthOpen(false);
      shouldFollowBottomRef.current = true;
    }
    activeSessionRef.current = id;
    setSessionId(id);
    setLoadingHistory(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/sessions/${id}/messages`, { cache: "no-store", signal: controller.signal });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "Falha ao abrir conversa.");
      if (controller.signal.aborted || activeSessionRef.current !== id) return;
      const loadedMessages = (data.messages || []) as ChatMessage[];
      messagesRef.current = loadedMessages;
      setMessages(loadedMessages);
      setBudgetTier(data.session?.budget_tier || "minimal");
      setLastRefreshAt(new Date().toISOString());
      missionPlans(loadedMessages).filter((plan) => plan.taskStatus === "executing")
        .forEach((plan) => void pollTaskUntilSettled(plan.taskId!, id));
    } catch (err) {
      if (!controller.signal.aborted && activeSessionRef.current === id) setError(err instanceof Error ? err.message : "Falha ao abrir conversa.");
    } finally { if (!controller.signal.aborted) setLoadingHistory(false); }
  }

  function newConversation() {
    sessionRequestRef.current?.abort();
    outputRequestRef.current?.abort();
    stopPolling();
    activeSessionRef.current = null;
    messagesRef.current = [];
    setSessionId(null);
    setMessages([]);
    setMonitoredTaskId(null);
    setMessage("");
    setBudgetTier("minimal");
    setError("");
    setNotice("");
    setLoadingHistory(false);
    setOutputsTaskId(null);
    setDecisionDialog(null);
    setHealthOpen(false);
  }

  async function refreshTaskStatus(taskId: string, options: { signal?: AbortSignal; quiet?: boolean } = {}) {
    const originSession = activeSessionRef.current;
    const response = await fetch(`/api/tasks/${taskId}/status?compact=1`, { cache: "no-store", signal: options.signal });
    const data = await readApiResponse(response);
    if (!response.ok || !data.task) throw new Error(data.message || "Não foi possível atualizar o estado desta missão.");
    if (originSession === activeSessionRef.current && !options.signal?.aborted && mountedRef.current) {
      const runtime = runtimeFromTask(data.task, (data.steps || []) as RuntimeStep[]);
      setMessages((current) => {
        const updated = current.map((item) => item.payload?.taskId === taskId
          ? { ...item, payload: { ...item.payload, taskStatus: data.task.status, runtime } }
          : item);
        messagesRef.current = updated;
        return updated;
      });
      setLastRefreshAt(new Date().toISOString());
    }
    return data.task as Record<string, unknown>;
  }

  async function pollTaskUntilSettled(taskId: string, originSession = activeSessionRef.current) {
    if (pollingTasksRef.current.has(taskId) || !originSession) return;
    const controller = new AbortController();
    pollingTasksRef.current.set(taskId, controller);
    let consecutiveErrors = 0;
    try {
      while (!controller.signal.aborted) {
        if (originSession !== activeSessionRef.current) return;
        try {
          const task = await refreshTaskStatus(taskId, { signal: controller.signal, quiet: true });
          consecutiveErrors = 0;
          const status = String(task.status);
          if (task.is_stale || SETTLED_TASK_STATUSES.has(status)) return;
        } catch (err) {
          if (controller.signal.aborted) return;
          consecutiveErrors += 1;
          if (consecutiveErrors >= 3) {
            setError("O monitor perdeu a conexão com o servidor. A tarefa não foi cancelada; use Atualizar para confirmar o estado.");
            return;
          }
        }
        await new Promise<void>((resolve) => {
          const onAbort = () => { window.clearTimeout(timer); resolve(); };
          const timer = window.setTimeout(() => { controller.signal.removeEventListener("abort", onAbort); resolve(); }, 2500);
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    } finally {
      if (pollingTasksRef.current.get(taskId) === controller) pollingTasksRef.current.delete(taskId);
    }
  }

  async function refreshMission(taskId: string) {
    const originSession = activeSessionRef.current;
    setDecisionLoading(taskId);
    setError("");
    try {
      const task = await refreshTaskStatus(taskId);
      if (originSession !== activeSessionRef.current) return;
      if (task.status === "executing" && !task.is_stale) void pollTaskUntilSettled(taskId);
      setNotice("Estado confirmado no servidor. O histórico da conversa não substitui este diagnóstico.");
    } catch (err) {
      if (originSession === activeSessionRef.current) setError(err instanceof Error ? err.message : "Falha ao atualizar.");
    }
    finally { setDecisionLoading(null); }
  }

  async function enqueueApproved(taskId: string, originSession: string | null) {
    const response = await fetch(`/api/tasks/${taskId}/execute`, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.message || "A autorização foi registrada, mas a execução não iniciou. Atualize e tente iniciar a etapa autorizada.");
    if (originSession === activeSessionRef.current) {
      await refreshTaskStatus(taskId);
      setNotice(data.message || "Etapa enfileirada em segundo plano. Minimizar ou fechar este painel não interrompe o processamento.");
      if (data.status === "executing" || data.status === "queued" || data.alreadyRunning) void pollTaskUntilSettled(taskId, originSession);
    }
  }

  async function decide(taskId: string, decision: Decision, note = "", targetStep?: number, phasePatch?: PhasePatch) {
    const originSession = activeSessionRef.current;
    setDecisionLoading(taskId);
    setError("");
    setDialogError("");
    try {
      const plan = missionPlans(messagesRef.current).find((item) => item.taskId === taskId);
      if (!plan) throw new Error("O plano não está mais aberto nesta conversa. Atualize antes de autorizar.");
      const response = await fetch(`/api/tasks/${taskId}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim(), targetStep, expectedRevision: controlRevisionOf(plan.runtime),
          ...(decision === "redo" && phasePatch ? { phasePatch } : {}) }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) {
        if (response.status === 409) {
          await refreshTaskStatus(taskId).catch(() => null);
          throw new Error(data.message || "A missão mudou desde a última leitura. Confira o novo estado e confirme a ação novamente.");
        }
        throw new Error(data.message || "Falha ao registrar decisão.");
      }
      if (originSession !== activeSessionRef.current) return;
      setDecisionDialog(null);
      setDecisionNote("");
      await refreshTaskStatus(taskId);
      setNotice(data.message || "Decisão humana registrada com checkpoints e outputs preservados.");
      if (data.status === "approved") await enqueueApproved(taskId, originSession);
      if (decision === "revise") setMessage("Revise o plano desta missão conforme esta orientação: ");
    } catch (err) {
      if (originSession === activeSessionRef.current) {
        const detail = err instanceof Error ? err.message : "Falha ao registrar decisão.";
        setError(detail);
        setDialogError(detail);
      }
    } finally { setDecisionLoading(null); }
  }

  function openDecision(plan: PlanPayload, decision: Decision, step?: number) {
    if (!plan.taskId) return;
    setOutputsTaskId(null);
    setHealthOpen(false);
    setDialogError("");
    setDecisionNote("");
    const targetStep = step ?? (decision === "redo" ? phaseReportOf(plan.runtime)?.step ?? plan.runtime?.currentStep ?? undefined : undefined);
    const current = plan.pipeline?.find((phase) => phase.step === targetStep) as (PhasePatch & { nodes: string[] }) | undefined;
    setPhasePatchEnabled(false);
    setPhasePatchNode(current?.nodes?.[0] || "A1");
    setPhasePatchCanvaMode(current?.canvaMode === "inspect" ? "inspect" : "create");
    setPhasePatchSourceRuns(current?.canvaSourceRunIds?.join(", ") || "");
    setPhasePatchDesignIds(current?.canvaDesignIds?.join(", ") || "");
    setDecisionDialog({ taskId: plan.taskId, title: plan.taskTitle || plan.summary, decision, step: targetStep });
  }

  function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decisionDialog) return;
    let phasePatch: PhasePatch | undefined;
    if (decisionDialog.decision === "redo" && phasePatchEnabled) {
      if (!PHASE_EXECUTORS.includes(phasePatchNode)) { setDialogError("Selecione um executor disponível para a nova configuração da fase."); return; }
      phasePatch = { nodes: [phasePatchNode] };
      if (phasePatchNode === "F6") {
        phasePatch.canvaMode = phasePatchCanvaMode;
        if (phasePatchCanvaMode === "inspect") {
          const sourceRunIds = [...new Set(phasePatchSourceRuns.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean))];
          const designIds = [...new Set(phasePatchDesignIds.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean))];
          if (!sourceRunIds.length || sourceRunIds.length > 20 || sourceRunIds.some((id) => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) ||
            !designIds.length || designIds.length > 10 || designIds.some((id) => !/^[A-Za-z0-9_-]{6,80}$/.test(id))) {
            setDialogError("Para inspecionar, informe de 1 a 20 IDs UUID de runs canônicos e de 1 a 10 IDs Canva presentes nesses outputs. Não use o Client ID ou o ID do usuário Canva."); return;
          }
          phasePatch.canvaSourceRunIds = sourceRunIds;
          phasePatch.canvaDesignIds = designIds;
        }
      }
    }
    void decide(decisionDialog.taskId, decisionDialog.decision, decisionNote, decisionDialog.step, phasePatch);
  }

  async function startApproved(taskId: string) {
    setDecisionLoading(taskId);
    setError("");
    try { await enqueueApproved(taskId, activeSessionRef.current); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha ao iniciar etapa autorizada."); }
    finally { setDecisionLoading(null); }
  }

  async function showOutputs(taskId: string, title: string) {
    outputRequestRef.current?.abort();
    const controller = new AbortController();
    outputRequestRef.current = controller;
    setDecisionDialog(null);
    setHealthOpen(false);
    setOutputsTaskId(taskId);
    setOutputsTitle(title);
    setOutputsItems([]);
    setOutputsTaskSummary(null);
    setOutputsError("");
    setOutputsLoading(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/outputs`, { cache: "no-store", signal: controller.signal });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "Falha ao carregar outputs.");
      if (controller.signal.aborted) return;
      setOutputsItems((data.items || []).map((item: OutputItem) => ({ ...item, links: safeOutputLinks(item.links) })));
      setOutputsTaskSummary(data.task || null);
    } catch (err) {
      if (!controller.signal.aborted) setOutputsError(err instanceof Error ? err.message : "Falha ao carregar outputs.");
    } finally { if (!controller.signal.aborted) setOutputsLoading(false); }
  }

  async function loadOrchestra(depth?: "basic" | "deep") {
    setHealthLoading(depth || "load");
    setHealthError("");
    try {
      const response = await fetch("/api/orchestra/health", {
        method: depth ? "POST" : "GET", cache: "no-store",
        ...(depth ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depth }) } : {}),
      });
      const data = await readApiResponse(response);
      if (data.report) setHealthReport(data.report);
      if (!response.ok) throw new Error(data.message || "Não foi possível consultar o afinamento.");
      if (!data.report) setHealthReport(null);
    } catch (err) { setHealthError(err instanceof Error ? err.message : "Falha ao consultar a orquestra."); }
    finally { setHealthLoading(null); }
  }

  function showOrchestra() {
    setOutputsTaskId(null);
    setDecisionDialog(null);
    setHealthOpen(true);
    void loadOrchestra();
  }

  async function downloadGuardianPacket(provider: "openai" | "claude") {
    setGuardianLoading(true);
    setHealthError("");
    try {
      const query = new URLSearchParams({ provider });
      const target = guardianReviewTaskId || monitoredPayload?.taskId;
      if (target) query.set("taskId", target);
      const response = await fetch(`/api/orchestra/guardians?${query}`, { cache: "no-store" });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "Não foi possível gerar o pacote do guardião.");
      const packet = data.packet || data.report || data;
      if (packet && typeof packet === "object") {
        const revisions: Record<number, number> = {};
        for (const step of packet.evidence?.steps || []) {
          if (Number.isInteger(step.step_number) && Number.isInteger(step.revision)) revisions[step.step_number] = step.revision;
        }
        setGuardianPacket({ provider, taskId: packet.evidence?.task?.id || target || null,
          packetId: packet.packetId, sourceCommit: packet.sourceCommit, generatedAt: packet.generatedAt,
          includedFiles: packet.sourceEvidence?.includedFiles, expectedFiles: packet.sourceEvidence?.expectedFiles,
          completeRelevantSnapshot: Boolean(packet.sourceEvidence?.completeRelevantSnapshot), stepRevisions: revisions });
      }
      downloadText(typeof packet === "string" ? packet : JSON.stringify(packet, null, 2), `regente-v07-revisao-${provider}${typeof packet === "string" ? ".md" : ".json"}`, typeof packet === "string" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8");
    } catch (err) { setHealthError(err instanceof Error ? err.message : "Falha ao obter pacote de revisão."); }
    finally { setGuardianLoading(false); }
  }

  async function importGuardianReview(event: FormEvent) {
    event.preventDefault();
    if (!guardianReviewPlan?.taskId || !guardianSelectedStep || guardianReview.trim().length < 20 || !guardianManualSource) return;
    setGuardianImportLoading(true);
    setGuardianImportError("");
    setGuardianImportNotice("");
    const taskId = guardianReviewPlan.taskId;
    const packet = guardianPacket?.provider === "claude" && guardianPacket.taskId === taskId ? guardianPacket : null;
    const revision = packet?.stepRevisions[guardianSelectedStep] ?? guardianSelectedRuntime?.revision ?? 1;
    try {
      const response = await fetch("/api/orchestra/guardians", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "claude", taskId, review: guardianReview.trim(), acknowledgeManualSource: true,
          step: guardianSelectedStep, revision, ...(packet?.packetId ? { packetId: packet.packetId } : {}),
          ...(packet?.sourceCommit ? { sourceCommit: packet.sourceCommit } : {}) }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "O parecer não foi registrado. Nenhuma autorização foi concedida.");
      const warning = data.review?.revisionMatches === false
        ? " A revisão declarada não corresponde à etapa atual; gere um pacote atualizado antes de tentar usar o parecer."
        : data.review?.sourceCommitMatches === false ? " O código do parecer difere do deployment atual; confira o diagnóstico antes de usá-lo." : "";
      setGuardianImportNotice((data.message || "Parecer registrado como importação humana, com identidade Claude não verificada. A pipeline não foi autorizada nem avançada.") + warning);
      setGuardianReview("");
      setGuardianManualSource(false);
      await refreshTaskStatus(taskId).catch(() => null);
    } catch (err) { setGuardianImportError(err instanceof Error ? err.message : "Falha ao registrar o parecer externo."); }
    finally { setGuardianImportLoading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || loading) return;
    const originSession = activeSessionRef.current;
    const optimisticId = `local-${Date.now()}`;
    setMessages((current) => [...current, { id: optimisticId, role: "user", content: text }]);
    setMessage("");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/regente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: originSession, message: text, budgetTier }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "Falha ao consultar o Regente.");
      if (activeSessionRef.current !== originSession) return;
      activeSessionRef.current = data.sessionId;
      setSessionId(data.sessionId);
      setMessages((current) => {
        const updated: ChatMessage[] = [...current, { id: `assistant-${Date.now()}`, role: "assistant", content: data.message, payload: data.output }];
        messagesRef.current = updated;
        return updated;
      });
      if (data.output?.taskId) setMonitoredTaskId(data.output.taskId);
      void loadSessions(false);
      // A fresh plan is not an authorization. Previously approved tasks alone can enqueue.
      if (data.output?.taskId && data.output.taskStatus === "approved") await startApproved(data.output.taskId);
    } catch (err) {
      if (activeSessionRef.current === originSession) {
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        setMessage(text);
        setError(err instanceof Error ? err.message : "Falha ao consultar o Regente.");
      }
    } finally { setLoading(false); }
  }

  const plans = missionPlans(messages);
  const monitoredPayload = plans.find((plan) => plan.taskId === monitoredTaskId) || plans[plans.length - 1] || null;
  const monitoredReport = phaseReportOf(monitoredPayload?.runtime);
  const monitoredStepNumber = monitoredReport?.step ?? monitoredPayload?.runtime?.currentStep ?? null;
  const monitoredStep = monitoredPayload?.runtime?.steps?.find((step) => step.step_number === monitoredStepNumber);
  const monitoredPlanStep = monitoredPayload?.pipeline?.find((step) => step.step === monitoredStepNumber);
  const monitoredCounts = runtimeCounts(monitoredPayload?.runtime);
  const monitoredProgress = Math.max(0, Math.min(100, monitoredPayload?.runtime?.progressPercent ?? 0));
  const monitorNeedsRecovery = monitoredPayload ? needsRecovery(monitoredPayload) : false;
  const monitoredAttention = monitoredPayload?.runtime?.attention;
  const selectedOutputTitle = monitoredPayload?.taskTitle || monitoredPayload?.summary || "Missão";
  const guardianReviewPlan = plans.find((plan) => plan.taskId === guardianReviewTaskId) || monitoredPayload;
  const guardianA6 = guardianReviewPlan?.pipeline?.find((step) => step.nodes.includes("A6") &&
    guardianReviewPlan.runtime?.steps?.find((runtimeStep) => runtimeStep.step_number === step.step)?.status !== "succeeded");
  const guardianSelectedStep = guardianReviewStep ?? guardianA6?.step ?? guardianReviewPlan?.runtime?.currentStep ?? guardianReviewPlan?.pipeline?.[0]?.step;
  const guardianSelectedRuntime = guardianReviewPlan?.runtime?.steps?.find((step) => step.step_number === guardianSelectedStep);
  const guardianMatchingPacket = guardianPacket?.provider === "claude" && guardianPacket.taskId === guardianReviewPlan?.taskId ? guardianPacket : null;

  function renderPhaseControls(plan: PlanPayload, compact = false) {
    if (!plan.taskId) return null;
    const report = phaseReportOf(plan.runtime);
    const status = plan.taskStatus;
    const recovery = needsRecovery(plan);
    const activeStep = plan.pipeline?.find((step) => step.step === (report?.step ?? plan.runtime?.currentStep));
    const optional = Boolean(activeStep?.onUnavailable === "skip" || activeStep?.optional);
    const busy = Boolean(decisionLoading);
    return (
      <div className={compact ? "task-live-actions" : "approval-actions"}>
        {status === "awaiting_validation" && report ? (
          <>
            <button type="button" disabled={busy} onClick={() => void decide(plan.taskId!, "continue", "", report.step)}>
              {report.final ? "Validar e finalizar missão" : "Validar e seguir para a próxima"}
            </button>
            <button type="button" className="secondary-action" onClick={() => void showOutputs(plan.taskId!, plan.taskTitle || plan.summary)}>Revisar resultados</button>
            <button type="button" className="secondary-action" disabled={busy} onClick={() => openDecision(plan, "redo", report.step)}>Refazer esta fase</button>
          </>
        ) : status === "awaiting_approval" ? (
          <>
            <button type="button" disabled={busy} onClick={() => openDecision(plan, "execute", plan.runtime?.currentStep ?? undefined)}>Autorizar próxima etapa</button>
            {!compact && <button type="button" className="secondary-action" disabled={busy} onClick={() => openDecision(plan, "revise")}>Revisar plano</button>}
          </>
        ) : status === "approved" ? (
          <button type="button" disabled={busy} onClick={() => void startApproved(plan.taskId!)}>Iniciar etapa autorizada</button>
        ) : recovery ? (
          <>
            <button type="button" disabled={busy} onClick={() => openDecision(plan, status === "executing" ? "recover" : "execute", plan.runtime?.currentStep ?? undefined)}>
              {status === "executing" ? "Autorizar recuperação segura" : "Autorizar retomada do checkpoint"}
            </button>
            {!compact && <button type="button" className="secondary-action" disabled={busy} onClick={() => openDecision(plan, "redo", plan.runtime?.currentStep ?? undefined)}>Reorientar esta etapa</button>}
          </>
        ) : null}
        {optional && ["failed", "blocked", "awaiting_approval"].includes(status || "") && (
          <button type="button" className="secondary-action" disabled={busy} onClick={() => openDecision(plan, "skip", activeStep?.step)}>Pular etapa opcional</button>
        )}
        {!compact && ["awaiting_validation", "awaiting_approval", "blocked", "failed", "needs_revision"].includes(status || "") && (
          <button type="button" className="danger-action" disabled={busy} onClick={() => openDecision(plan, "reject")}>Encerrar missão</button>
        )}
        {compact && <button type="button" className="task-monitor-outputs secondary-action" onClick={() => void showOutputs(plan.taskId!, plan.taskTitle || plan.summary)}>Outputs e versões ↗</button>}
      </div>
    );
  }

  function renderPhaseReport(plan: PlanPayload, compact = false) {
    const report = phaseReportOf(plan.runtime);
    if (!report || plan.taskStatus !== "awaiting_validation") return null;
    return (
      <section className={`phase-report${compact ? " phase-report-compact" : ""}`} aria-label={`Relatório da fase ${report.step}`}>
        <span className="eyebrow">VALIDAÇÃO HUMANA · FASE {report.step} · REVISÃO {report.revision ?? 1}</span>
        <h3>{report.title || `Fase ${report.step} concluída`}</h3>
        <p>{report.summary || "O output foi produzido. Revise o conteúdo antes de autorizar a continuação."}</p>
        <small>Produzido em {taskUpdatedLabel(report.completedAt)} · {report.final ? "Última fase: falta sua validação final." : `Próxima fase: ${report.nextStep ?? "a determinar pelo servidor"}.`}</small>
        {!compact && report.output != null && (
          <details><summary>Ver conteúdo desta revisão</summary><pre>{outputText(report.output)}</pre></details>
        )}
        {!!report.limitations?.length && (
          <details><summary>Limitações e itens não verificados ({report.limitations.length})</summary><ul>{report.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details>
        )}
        {renderPhaseControls(plan, compact)}
      </section>
    );
  }

  return (
    <main className="regent-app">
      <header className="regent-header">
        <div>
          <span className="eyebrow">REDE OPTÓTICA + ENSAVIM</span>
          <h1>Regente</h1>
          <p>v0.7.0 · execução fase a fase · validação humana · orquestra verificável</p>
          <small>Servidor: {release?.version || "verificação pendente"}{(release?.commit || release?.gitCommit) ? ` · ${(release.commit || release.gitCommit)!.slice(0, 7)}` : ""}</small>
        </div>
        <div className="header-controls">
          <span className="status">● Autorização por etapa</span>
          <button type="button" className="secondary-action" onClick={showOrchestra}>Afinar orquestra</button>
        </div>
      </header>
      {release?.version && !String(release.version).startsWith("0.7") && <p className="task-stale-warning" role="alert">O servidor ainda informa {release.version}. O front 0.7 não confirma atualização do backend; verifique o deployment antes de executar.</p>}

      <div className="chat-layout">
        <aside className="conversation-sidebar" aria-label="Conversas">
          <button className="new-chat-button" type="button" disabled={loading} onClick={newConversation}>+ Nova conversa</button>
          <div className="conversation-list">
            {sessions.map((session) => (
              <button key={session.id} type="button" disabled={loading} className={session.id === sessionId ? "conversation-item active" : "conversation-item"} onClick={() => void openSession(session.id)} aria-current={session.id === sessionId ? "page" : undefined}>
                <strong>{session.title}</strong><small>{taskUpdatedLabel(session.updated_at)}</small>
              </button>
            ))}
            {!sessions.length && !loadingHistory && <p className="empty-conversations">Nenhuma conversa ainda.</p>}
          </div>
        </aside>

        <section className="chat-panel" aria-label="Conversa com o Regente">
          <div className="chat-toolbar">
            <div><strong>{sessionId ? "Conversa atual" : "Nova conversa"}</strong><small>O histórico permanece; o estado vivo de cada missão vem do servidor.</small></div>
            <div className="chat-toolbar-actions">
              <div className="chat-nav-buttons" aria-label="Navegar na conversa">
                <button type="button" onClick={() => goToMessageEdge("top")} aria-label="Ir ao início da conversa">↑ Topo</button>
                <button type="button" onClick={() => goToMessageEdge("bottom")} aria-label="Ir ao fim da conversa">↓ Fim</button>
                {sessionId && <button type="button" onClick={() => void openSession(sessionId)} disabled={loadingHistory || loading}>↻ Atualizar</button>}
              </div>
              <label className="budget-control">Orçamento<select value={budgetTier} disabled={loading} onChange={(event) => setBudgetTier(event.target.value as Session["budget_tier"])}>
                <option value="minimal">Mínimo</option><option value="controlled">Controlado</option><option value="flexible">Flexível</option>
              </select></label>
            </div>
          </div>

          {plans.length > 0 && <div className="mission-switcher">
            <label htmlFor="mission-select">Acompanhar missão</label>
            <select id="mission-select" value={monitoredPayload?.taskId || ""} onChange={(event) => { setMonitoredTaskId(event.target.value); void refreshMission(event.target.value); }}>
              {plans.map((plan) => <option key={plan.taskId} value={plan.taskId}>{plan.taskTitle || plan.summary} · {taskStatusLabel(plan.taskStatus)}</option>)}
            </select>
            <button type="button" className="secondary-action" onClick={() => changeMonitorSize(monitorSize === "minimized" ? "normal" : "minimized")}>{monitorSize === "minimized" ? "Expandir monitor ↑" : "Recolher monitor ↓"}</button>
          </div>}

          <div className="message-stream" ref={streamRef} onScroll={trackScroll} aria-busy={loadingHistory}>
            {loadingHistory && <p role="status">Carregando conversa e estados das missões…</p>}
            {!messages.length && !loadingHistory && <div className="chat-welcome">
              <span className="eyebrow">REGENTE v0.7</span><h2>Qual resultado precisamos produzir?</h2>
              <p>Primeiro verifique a orquestra. Depois autorize uma etapa, confira o output e decida como continuar. Seu trabalho já concluído permanece preservado.</p>
            </div>}

            {messages.map((item) => {
              const plan = item.payload && !item.payload.notification && Array.isArray(item.payload.pipeline) && typeof item.payload.summary === "string" ? item.payload as PlanPayload : null;
              const counts = runtimeCounts(plan?.runtime);
              return (
                <article key={item.id} className={`chat-message ${item.role}`}>
                  <div className="message-author">{item.role === "user" ? "Você" : "Regente"}{item.created_at ? ` · ${taskUpdatedLabel(item.created_at)}` : ""}</div>
                  <div className="message-bubble">
                    {item.role === "assistant" && item.payload?.taskId && <small className="historical-message-label">Mensagem do histórico · acompanhe o estado atualizado da missão {plan ? "abaixo" : "no monitor"}.</small>}
                    <p>{renderMessageContent(item.content)}</p>
                    {item.payload?.notification && item.payload.taskId && <button type="button" className="notification-mission-button secondary-action" onClick={() => { setMonitoredTaskId(item.payload!.taskId!); changeMonitorSize("normal"); void refreshMission(item.payload!.taskId!); }}>Ver estado atual desta missão ↗</button>}
                    {item.role === "assistant" && plan && (
                      <details className="plan-details" open={Boolean(plan.pipeline?.length)}>
                        <summary>Pipeline e estado atual{plan.taskId ? ` · ${taskStatusLabel(plan.taskStatus)}` : ""}</summary>
                        <div className="plan-summary">
                          <div className="plan-meta-row">
                            <span className={`pill ${plan.status}`}>{plan.status === "proceed" ? "Plano disponível" : plan.status === "needs_human" ? "Decisão humana" : "Bloqueio no plano"}</span>
                            {plan.depth && <span className="pipeline-tag">profundidade: {plan.depth}</span>}
                            {plan.risk && <span className="pipeline-tag">risco: {plan.risk}</span>}
                          </div>
                          <strong>{plan.taskTitle || plan.summary}</strong><small>{plan.summary}</small>
                        </div>

                        {plan.taskId && <section className="task-state-card" aria-label="Estado persistente da missão">
                          <div className="pipeline-step-head"><strong>{taskStatusLabel(plan.taskStatus)}</strong><span className="pipeline-tag">{counts.produced} produzidas · {counts.validated} validadas</span></div>
                          <progress value={Math.max(0, Math.min(100, plan.runtime?.progressPercent ?? 0))} max={100} aria-label="Progresso das etapas" />
                          <div className="task-output-summary">
                            <span><b>{counts.produced}</b> etapas com output</span><span><b>{counts.validated}</b> validadas por você</span><span><b>{counts.pending}</b> ainda pendentes</span>
                          </div>
                          {counts.skipped > 0 && <small>{counts.skipped} etapa(s) pulada(s) com autorização; não são outputs produzidos.</small>}
                          <small><b>Etapa atual:</b> {phaseReportOf(plan.runtime)?.step ?? plan.runtime?.currentStep ?? "nenhuma ativa"}</small>
                          <small><b>Próxima ação:</b> {plan.runtime?.nextAction || plan.nextAction || "Atualize para confirmar o próximo passo."}</small>
                          <small><b>Estado atualizado:</b> {taskUpdatedLabel(plan.runtime?.updatedAt)}</small>
                          {plan.runtime?.blockedReason && <div className="task-blocked-detail" role="status"><b>Bloqueio:</b> {plan.runtime.blockedReason}</div>}
                          {errorMessage(plan.runtime?.lastError) && <small><b>Último erro registrado:</b> {errorMessage(plan.runtime?.lastError)}</small>}
                          {plan.taskStatus === "executing" && needsRecovery(plan) && <div className="task-stale-warning" role="status">A execução não tem atividade ou lease válido recente. Atualize o estado antes de autorizar recuperação. O servidor impedirá duplicação de uma execução ativa.</div>}
                          <div className="task-card-actions">
                            <button type="button" className="secondary-action" disabled={Boolean(decisionLoading)} onClick={() => void refreshMission(plan.taskId!)}>↻ Confirmar estado</button>
                            <button type="button" className="task-outputs-button" onClick={() => void showOutputs(plan.taskId!, plan.taskTitle || plan.summary)}>Abrir outputs e versões ↗</button>
                          </div>
                        </section>}

                        {renderPhaseReport(plan)}
                        {plan.taskId && plan.taskStatus !== "awaiting_validation" && ["awaiting_approval", "approved", "failed", "blocked", "needs_revision"].includes(plan.taskStatus || "") && (
                          <section className="approval-gate">
                            <strong>{needsRecovery(plan) ? "Retomada supervisionada" : plan.taskStatus === "needs_revision" ? "Nova orientação necessária" : "Autorização por etapa"}</strong>
                            <small>Uma autorização libera apenas a próxima etapa elegível. Outputs anteriores e checkpoints não são apagados; cada fase volta para sua validação.</small>
                            {renderPhaseControls(plan)}
                          </section>
                        )}

                        {!!plan.pipeline?.length && <div className="pipeline-list">
                          {plan.pipeline.map((step) => {
                            const currentStep = plan.runtime?.steps?.find((runtimeStep) => runtimeStep.step_number === step.step);
                            const humanValidated = Boolean(currentStep?.validated_at || (plan.runtime?.validatedSteps || plan.runtime?.validated_steps || []).includes(step.step));
                            return <div className={`pipeline-step${humanValidated ? " phase-validated" : ""}`} key={step.step}>
                              <div className="pipeline-step-head"><strong>{step.step}. {roleLabel(step.role)}</strong><span className={`execution-state ${currentStep?.status || step.executionState}`}>{humanValidated && currentStep?.status === "succeeded" ? "Validada por você" : stepStatusLabel(currentStep?.status || step.executionState)}</span></div>
                              <p>{step.action}</p><small><b>Nós:</b> {step.nodes.join(", ")}</small><small><b>Entrada:</b> {step.input}</small><small><b>Saída esperada:</b> {step.expectedOutput}</small>
                              {!!step.dependsOn?.length && <small><b>Dependências:</b> {step.dependsOn.join(", ")}</small>}
                              {currentStep?.revision ? <small><b>Revisão atual:</b> {currentStep.revision}</small> : null}
                              {currentStep?.attempt_count ? <small><b>Tentativas registradas:</b> {currentStep.attempt_count}</small> : null}
                              {errorMessage(currentStep?.last_error) && <small className="step-error"><b>Diagnóstico:</b> {errorMessage(currentStep?.last_error)}</small>}
                              {currentStep?.next_action && <small><b>Ação indicada:</b> {currentStep.next_action}</small>}
                            </div>;
                          })}
                        </div>}
                        {plan.picker?.enabled && <div className="picker-card"><strong>Seleção supervisionada</strong><small>{plan.picker.variantsRequested} variantes · critérios: {plan.picker.criteria.join(", ")}</small><small>O Regente recomenda; você valida a escolha final.</small></div>}
                      </details>
                    )}
                  </div>
                </article>
              );
            })}
            {loading && <article className="chat-message assistant"><div className="message-author">Regente</div><div className="message-bubble typing" role="status">Montando o plano e verificando critérios de execução…</div></article>}
          </div>

          {error && <p className="chat-error" role="alert">{error}</p>}
          {notice && <p className="chat-notice" role="status">{notice}</p>}
          <form onSubmit={submit} className="chat-composer">
            <textarea aria-label="Mensagem para o Regente" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} placeholder="Descreva a missão ou oriente a revisão. Cada fase será validada antes da próxima." rows={3} required disabled={loading} />
            <button disabled={loading || !message.trim()} type="submit">{loading ? "Orquestrando…" : "Enviar"}</button>
          </form>
        </section>
      </div>

      {monitoredPayload?.taskId && <aside className={`task-live-monitor monitor-${monitorSize} task-live-${monitoredPayload.taskStatus || "unknown"}`} aria-label="Monitor da missão">
        <div className="task-live-head">
          <div><span className="task-live-kicker">ACOMPANHAMENTO · FASE {monitoredStepNumber ?? "—"}</span><strong title={selectedOutputTitle}>{selectedOutputTitle}</strong></div>
          <div className="monitor-size-controls">
            {monitorSize !== "minimized" && <button type="button" title="Minimizar monitor" aria-label="Minimizar monitor sem interromper execução" onClick={() => changeMonitorSize("minimized")}>▾</button>}
            <button type="button" title={monitorSize === "expanded" ? "Voltar ao tamanho normal" : "Ampliar monitor"} aria-label={monitorSize === "expanded" ? "Voltar ao tamanho normal" : "Ampliar monitor"} aria-expanded={monitorSize !== "minimized"} onClick={() => changeMonitorSize(monitorSize === "expanded" ? "normal" : monitorSize === "minimized" ? "normal" : "expanded")}>{monitorSize === "expanded" ? "↙" : "↗"}</button>
          </div>
        </div>
        <div className="monitor-status-line"><span className="task-live-status" role="status">{taskStatusLabel(monitoredPayload.taskStatus)}</span><b>{monitoredProgress}%</b></div>
        <progress value={monitoredProgress} max={100} aria-label="Progresso das etapas da missão" />
        {monitorSize === "minimized" ? (
          <small className={`monitor-mini-action${monitoredPayload.taskStatus === "awaiting_validation" || monitorNeedsRecovery ? " requires-attention" : ""}`}>
            {monitoredPayload.taskStatus === "awaiting_validation" ? "Seu output está pronto para validar. Expanda para continuar." : monitorNeedsRecovery ? "Ação humana necessária. Expanda para ver o diagnóstico." : "Monitor minimizado; execução e checkpoints continuam."}
          </small>
        ) : <div className="monitor-content">
          {plans.length > 1 && <label className="monitor-mission-select">Missão<select value={monitoredPayload.taskId} onChange={(event) => { setMonitoredTaskId(event.target.value); void refreshMission(event.target.value); }}>{plans.map((plan) => <option key={plan.taskId} value={plan.taskId}>{plan.taskTitle || plan.summary}</option>)}</select></label>}
          <div className="task-live-grid"><span><b>Fase</b>{monitoredStepNumber ?? "—"}</span><span><b>Laço</b>{roleLabel(monitoredStep?.role || monitoredPlanStep?.role)}</span><span><b>Nó</b>{(monitoredStep?.node_ids || monitoredPlanStep?.nodes || []).join(", ") || "—"}</span></div>
          <small className="task-live-next"><b>Agora:</b> {monitoredPayload.runtime?.nextAction || monitoredPayload.nextAction || "Confirme o estado no servidor."}</small>
          <small className="monitor-counts">{monitoredCounts.produced} etapas produzidas · {monitoredCounts.validated} validadas · {monitoredCounts.skipped} puladas</small>
          <small>Última atividade: {taskUpdatedLabel(monitoredPayload.runtime?.lastActivityAt || monitoredPayload.runtime?.updatedAt)}</small>
          <small>Consulta do painel: {taskUpdatedLabel(lastRefreshAt)}</small>
          {monitoredAttention && <div className={`task-live-attention task-live-attention-${monitoredAttention.severity}`}>
            <strong>{monitoredAttention.title}</strong><small>{monitoredAttention.message}</small>{monitoredAttention.attempts > 0 && <small>Tentativas: {monitoredAttention.attempts}</small>}{monitoredAttention.error && <small>Último erro: {monitoredAttention.error}</small>}
          </div>}
          {monitoredPayload.runtime?.recovery?.recoveredStep && !monitoredPayload.runtime.recovery.active && <div className="task-live-recovered"><strong>Checkpoint recuperado</strong><small>Etapa {monitoredPayload.runtime.recovery.recoveredStep} recuperada após {monitoredPayload.runtime.recovery.recoveredAttempts} tentativas registradas. Outputs anteriores preservados.</small></div>}
          {monitorNeedsRecovery && !monitoredAttention && <div className="task-live-attention task-live-attention-critical"><strong>Confirme e autorize a correção</strong><small>{monitoredPayload.runtime?.blockedReason || "A execução está sem atividade recente. O estado e o lock serão verificados pelo servidor antes da retomada."}</small></div>}
          {renderPhaseReport(monitoredPayload, true)}
          {monitoredPayload.taskStatus !== "awaiting_validation" && renderPhaseControls(monitoredPayload, true)}
          <button type="button" className="monitor-refresh secondary-action" disabled={Boolean(decisionLoading)} onClick={() => void refreshMission(monitoredPayload.taskId!)}>↻ Atualizar diagnóstico</button>
          {monitorSize === "expanded" && <details className="monitor-technical"><summary>Identificação e checkpoint</summary><small>Missão: {monitoredPayload.taskId}</small><small>Engine: {engineVersionOf(monitoredPayload.runtime)}</small><small>Revisão de controle: {controlRevisionOf(monitoredPayload.runtime)}</small><small>Workflow: {monitoredPayload.runtime?.workflowRunId || monitoredPayload.runtime?.workflow_run_id || "Não informado"}</small><small>Lease: {taskUpdatedLabel(monitoredPayload.runtime?.executionLeaseUntil || monitoredPayload.runtime?.execution_lease_until)}</small><p>Minimizar não interrompe a execução. Recomeçar uma fase preserva suas revisões anteriores; não libera outras fases automaticamente.</p></details>}
        </div>}
      </aside>}

      {outputsTaskId && <ModalFrame title={outputsTitle} label="Outputs e revisões preservadas" onClose={() => { outputRequestRef.current?.abort(); setOutputsTaskId(null); }}>
        {outputsTaskSummary && <div className="outputs-task-summary"><strong>{outputsTaskSummary.outputCount} outputs / versões disponíveis</strong><span>{outputsTaskSummary.completedSteps} de {outputsTaskSummary.totalSteps} etapas concluídas · {outputsTaskSummary.failedSteps} pausada(s)</span></div>}
        <p className="drawer-help">Este painel mostra os outputs registrados no sistema. Links de edição do Canva dependem das permissões da conta e da equipe; não confirmam a presença de um arquivo final importado.</p>
        <button type="button" className="secondary-action outputs-refresh" disabled={outputsLoading} onClick={() => void showOutputs(outputsTaskId, outputsTitle)}>↻ Atualizar outputs no servidor</button>
        {outputsLoading && <p role="status">Carregando outputs e revisões…</p>}
        {outputsError && <p className="task-stale-warning" role="alert">{outputsError}</p>}
        {!outputsLoading && !outputsError && !outputsItems.length && <p>Nenhum output persistente foi produzido. Etapas planejadas ou puladas não geram arquivos automaticamente.</p>}
        <div className="outputs-list">{outputsItems.map((output) => <article className="outputs-item" key={output.id}>
          <div className="pipeline-step-head"><strong>Etapa {output.step} · {output.node}</strong><span className="pipeline-tag">Revisão {output.revision ?? 1}</span></div>
          <small>{output.kind} · {output.source} · {stepStatusLabel(output.status)}</small><small>Gerado em {taskUpdatedLabel(output.createdAt)}</small>
          {output.id.startsWith("run-") && <small>ID canônico do run: <code>{output.id.slice(4)}</code></small>}
          <p className="outputs-preview">{output.content.slice(0, 420)}{output.content.length > 420 ? "…" : ""}</p>
          <div className="outputs-item-actions">
            {output.downloadUrl?.startsWith("/api/tasks/") ? <a className="button-link" href={output.downloadUrl} download>Baixar arquivo completo ↓</a> : <button type="button" onClick={() => downloadText(`# Etapa ${output.step} · ${output.node} · revisão ${output.revision ?? 1}\n\nGerado em: ${taskUpdatedLabel(output.createdAt)}\n\n${output.content}`, output.filename || `etapa-${output.step}-revisao-${output.revision ?? 1}.md`)}>Baixar conteúdo disponível (.md) ↓</button>}
          </div>
          {output.truncated && <small className="task-stale-warning">A prévia foi abreviada. Use o download completo para obter todo o conteúdo.</small>}
          {!!output.links.length && <div className="outputs-links">{output.links.map((link) => <a key={link} href={link} target="_blank" rel="noopener noreferrer">{/canva\.com/i.test(link) ? "Abrir no Canva" : /\.pdf(\?|#|$)/i.test(link) ? "Abrir PDF" : "Abrir arquivo ou referência"} ↗</a>)}</div>}
          <details><summary>Visualizar conteúdo registrado</summary><pre>{output.content}</pre></details>
        </article>)}</div>
      </ModalFrame>}

      {decisionDialog && <ModalFrame title={decisionDialog.title} label="Decisão humana auditável" onClose={() => { if (!decisionLoading) setDecisionDialog(null); }}>
        <form className="decision-form" onSubmit={submitDecision}>
          <h2>{decisionDialog.decision === "redo" ? "Refazer apenas esta fase" : decisionDialog.decision === "skip" ? "Pular etapa opcional" : decisionDialog.decision === "reject" ? "Encerrar esta missão" : decisionDialog.decision === "revise" ? "Reorientar o plano" : "Autorizar uma etapa"}</h2>
          <p>{decisionDialog.decision === "reject" ? "A missão será encerrada sem apagar outputs ou histórico." : decisionDialog.decision === "redo" ? "A revisão anterior permanece disponível. Informe o que deve mudar; o servidor verificará as dependências antes de aceitar a revisão." : decisionDialog.decision === "skip" ? "Somente uma etapa explicitamente opcional pode ser pulada. Isso não equivale a produzir um output." : decisionDialog.decision === "revise" ? "A execução será mantida pausada enquanto você orienta a revisão do plano." : "Você autoriza apenas a etapa elegível indicada pelo servidor. A continuação requer validar o output; a execução ativa será protegida contra duplicação."}</p>
          {decisionDialog.step != null && <p className="decision-step">Etapa solicitada: <b>{decisionDialog.step}</b></p>}
          {decisionDialog.decision === "redo" && <fieldset disabled={Boolean(decisionLoading)}>
            <legend>Configuração da nova revisão (opcional)</legend>
            <label className="guardian-source-acknowledgment"><input type="checkbox" checked={phasePatchEnabled} onChange={(event) => setPhasePatchEnabled(event.target.checked)} /> Ajustar configuração da fase</label>
            {phasePatchEnabled && <>
              <p>Você autoriza a troca desta fase para um único executor. Os outros nós não serão executados automaticamente; explique os limites e as fontes necessárias na orientação. Outputs e configurações anteriores ficam no histórico.</p>
              <label htmlFor="phase-executor">Executor<select id="phase-executor" value={phasePatchNode} onChange={(event) => setPhasePatchNode(event.target.value)}>
                {!PHASE_EXECUTORS.includes(phasePatchNode) && <option value={phasePatchNode}>{phasePatchNode} · configuração anterior (selecione um executor conectado)</option>}
                {PHASE_EXECUTORS.map((node) => <option key={node} value={node}>{node}{node === "A4" ? " · revisor independente OpenAI" : node === "A5" ? " · verificação local" : node === "A6" ? " · parecer Claude manual" : node === "F6" ? " · Canva via Portal" : node === "F9" ? " · Meta WhatsApp (configuração pode estar pendente)" : " · executor OpenAI"}</option>)}
              </select></label>
              {phasePatchNode === "A6" && <p>A6 exige importar um parecer externo desta fase e revisão; não comprova uma conexão automática com Anthropic.</p>}
              {phasePatchNode === "F9" && <p>Escolher F9 não configura credenciais nem autoriza envio WhatsApp. Se indisponível, o diagnóstico pedirá conexão ou adiamento explícito.</p>}
              {phasePatchNode === "F6" && <>
                <label htmlFor="phase-canva-mode">Operação Canva<select id="phase-canva-mode" value={phasePatchCanvaMode} onChange={(event) => setPhasePatchCanvaMode(event.target.value as "create" | "inspect")}><option value="create">Criar design editável novo</option><option value="inspect">Inspecionar designs existentes</option></select></label>
                {phasePatchCanvaMode === "inspect" ? <>
                  <p>Inspeção não cria um design novo nem entrega um arquivo final. Ela obtém metadados e prévias temporárias para revisão. Copie os IDs reais dos outputs registrados; o servidor verificará origem, validação e revisão.</p>
                  <label htmlFor="phase-canva-runs">IDs dos runs de origem (UUIDs, separados por vírgula)<textarea id="phase-canva-runs" rows={2} value={phasePatchSourceRuns} onChange={(event) => setPhasePatchSourceRuns(event.target.value)} required placeholder="ID canônico exibido no painel de outputs" /></label>
                  <label htmlFor="phase-canva-designs">IDs dos designs Canva (separados por vírgula)<textarea id="phase-canva-designs" rows={2} value={phasePatchDesignIds} onChange={(event) => setPhasePatchDesignIds(event.target.value)} required placeholder="IDs dos designs presentes nos outputs de origem" /></label>
                </> : <p>Esta opção autoriza criar designs editáveis novos nesta revisão. Jobs anteriores com efeito externo não confirmado precisam ser conferidos antes de uma nova importação; um link de edição não equivale a arquivo final exportado.</p>}
              </>}
            </>}
          </fieldset>}
          <label htmlFor="decision-note">{decisionDialog.decision === "redo" ? "Nova orientação (obrigatória)" : decisionDialog.decision === "skip" ? "Motivo para pular (obrigatório)" : "Orientação ou motivo (opcional)"}<textarea id="decision-note" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} required={["redo", "skip"].includes(decisionDialog.decision)} rows={4} disabled={Boolean(decisionLoading)} /></label>
          {dialogError && <p className="task-stale-warning" role="alert">{dialogError}</p>}
          <div className="approval-actions"><button type="submit" disabled={Boolean(decisionLoading) || (["redo", "skip"].includes(decisionDialog.decision) && !decisionNote.trim())}>{decisionLoading ? "Registrando…" : "Confirmar decisão"}</button><button type="button" className="secondary-action" disabled={Boolean(decisionLoading)} onClick={() => setDecisionDialog(null)}>Cancelar</button></div>
        </form>
      </ModalFrame>}

      {healthOpen && <ModalFrame title="Afinamento da orquestra" label="Diagnóstico de ferramentas e vínculos" onClose={() => setHealthOpen(false)} wide>
        <p className="drawer-help">Presença de uma variável não comprova autenticação, créditos ou operação. Este diagnóstico separa o que foi testado do que ainda precisa de confirmação.</p>
        <div className="approval-actions"><button type="button" disabled={Boolean(healthLoading)} onClick={() => void loadOrchestra("basic")}>{healthLoading === "basic" ? "Verificando…" : "Verificação básica"}</button><button type="button" className="secondary-action" disabled={Boolean(healthLoading)} onClick={() => void loadOrchestra("deep")}>{healthLoading === "deep" ? "Verificando vínculos…" : "Afinamento aprofundado"}</button></div>
        <small>Não autoriza criação de conteúdo pago, troca de credenciais, instalação de plugins ou alteração em produção.</small>
        {healthLoading === "load" && <p role="status">Carregando último diagnóstico persistido…</p>}
        {healthError && <p className="task-stale-warning" role="alert">{healthError}</p>}
        {!healthLoading && !healthReport && !healthError && <p>Nenhum afinamento registrado. Inicie uma verificação básica.</p>}
        {healthReport && <>
          <div className="health-summary"><strong>{healthReport.depth === "deep" ? "Afinamento aprofundado" : "Verificação básica"}</strong><small>Gerado: {taskUpdatedLabel(healthReport.generatedAt)} · Persistido: {taskUpdatedLabel(healthReport.persistedAt)}</small><p>{healthReport.summary?.healthy ?? 0} verificados · {healthReport.summary?.attention ?? 0} precisam de ação · {healthReport.summary?.unknown ?? 0} não verificados</p></div>
          <div className="health-check-list">{healthReport.checks?.map((check) => <article key={check.id} className={`health-check health-${check.state}`}><div className="pipeline-step-head"><strong>{check.label}</strong><span className="pipeline-tag">{healthStateLabel(check.state)}</span></div>{check.blocking && <small className="health-blocking">Bloqueia as etapas que dependem deste nó.</small>}<p>{check.detail}</p><dl><div><dt>Adapter conectado</dt><dd>{checkedBoolean(check.adapterConnected)}</dd></div><div><dt>Configuração presente</dt><dd>{checkedBoolean(check.configured)}</dd></div><div><dt>Autenticação verificada</dt><dd>{checkedBoolean(check.authenticated)}</dd></div><div><dt>Permissões verificadas</dt><dd>{checkedBoolean(check.authorized)}</dd></div><div><dt>Operação verificada</dt><dd>{checkedBoolean(check.operational)}</dd></div><div><dt>Identidade da conta</dt><dd>{check.account || "Não verificada"}</dd></div><div><dt>Créditos / faturamento</dt><dd>Não verificados</dd></div></dl>{check.action && <div className="health-next-action"><b>Ação necessária:</b> {check.action}</div>}</article>)}</div>
          {!!healthReport.nodes?.length && <details className="health-node-inventory"><summary>Inventário dos atores e nós ({healthReport.nodes.length})</summary><p>O cadastro de um nó não comprova que seu adapter, credencial ou operação estejam disponíveis. Confira os testes de conexão acima.</p><div className="health-table-scroll"><table><thead><tr><th scope="col">Nó</th><th scope="col">Ator / ferramenta</th><th scope="col">Papel</th><th scope="col">Adapter conectado</th></tr></thead><tbody>{healthReport.nodes.map((node) => <tr key={node.id}><th scope="row">{node.id}</th><td>{node.label || node.name || node.technology || "Não informado"}</td><td>{node.role || "Não informado"}</td><td>{node.adapter || checkedBoolean(node.adapterConnected)}</td></tr>)}</tbody></table></div></details>}
          {!!healthReport.links?.length && <section className="health-links"><h3>Vínculos entre atores</h3>{healthReport.links.map((link, index) => <div className="health-link" key={link.id || index}><strong>{link.from || "Origem"} → {link.to || "Destino"}</strong><span className="pipeline-tag">{healthStateLabel(link.state)}</span>{link.transport && <small>Canal: {link.transport}</small>}{link.accountSource && <small>Origem da credencial / conta: {link.accountSource}</small>}{link.detail && <p>{link.detail}</p>}{link.action && <small>Ação: {link.action}</small>}</div>)}</section>}
          {!!healthReport.limitations?.length && <details className="health-limitations" open><summary>Limites desta verificação</summary><ul>{healthReport.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
          <button type="button" className="secondary-action" onClick={() => downloadText(JSON.stringify(healthReport, null, 2), `regente-afinamento-${healthReport.depth}.json`, "application/json;charset=utf-8")}>Baixar diagnóstico auditável ↓</button>
        </>}
        <section className="guardian-panel">
          <h3>Guardiões especializados externos</h3><p>Os pacotes reúnem contexto técnico para revisores do Regente. A conta Claude.ai não comprova acesso programático; enquanto a rota não for validada, a revisão Claude fica manual, sem bloquear as etapas OpenAI.</p>
          {plans.length > 0 && <label htmlFor="guardian-task">Missão do parecer<select id="guardian-task" value={guardianReviewPlan?.taskId || ""} disabled={guardianImportLoading || guardianLoading} onChange={(event) => { setGuardianReviewTaskId(event.target.value); setGuardianReviewStep(null); setGuardianImportError(""); setGuardianImportNotice(""); }}>{plans.map((plan) => <option key={plan.taskId} value={plan.taskId}>{plan.taskTitle || plan.summary}</option>)}</select></label>}
          <div className="approval-actions"><button type="button" disabled={guardianLoading || guardianImportLoading} onClick={() => void downloadGuardianPacket("openai")}>{guardianLoading ? "Preparando pacote…" : "Pacote para guardião OpenAI ↓"}</button><button type="button" className="secondary-action" disabled={guardianLoading || guardianImportLoading} onClick={() => void downloadGuardianPacket("claude")}>Pacote para guardião Claude ↓</button></div>
          {guardianPacket && <div className="guardian-packet-metadata"><strong>Último pacote: {guardianPacket.provider === "claude" ? "Claude" : "OpenAI"}</strong><small>ID: {guardianPacket.packetId || "Não informado"}</small><small>Gerado em: {taskUpdatedLabel(guardianPacket.generatedAt)}</small><small>Commit de origem: {guardianPacket.sourceCommit || "Não verificado"}</small><small>Fontes incluídas: {guardianPacket.includedFiles ?? "Não informado"} / {guardianPacket.expectedFiles ?? "Não informado"} · {guardianPacket.completeRelevantSnapshot ? "Snapshot relevante completo" : "Snapshot parcial ou não verificado"}</small></div>}
          <small>Baixar um pacote não significa que um revisor já avaliou o sistema. DeepSeek será tratado na 0.8.</small>
          {guardianReviewPlan?.taskId && guardianReviewPlan.pipeline?.length ? <form className="guardian-import-form" onSubmit={importGuardianReview}>
            <h4>Importar parecer manual do Claude</h4><p>Cole o parecer obtido fora do sistema. Ele será registrado como evidência fornecida por você, com identidade do provedor não verificada. Não aprova a fase e não confirma participação automática do Claude.</p>
            <label htmlFor="guardian-step">Etapa revisada<select id="guardian-step" value={guardianSelectedStep ?? ""} disabled={guardianImportLoading} onChange={(event) => setGuardianReviewStep(Number(event.target.value))}>{guardianReviewPlan.pipeline.map((step) => <option key={step.step} value={step.step}>{step.step}. {roleLabel(step.role)} · {step.nodes.join(", ")}</option>)}</select></label>
            <small>Revisão declarada: {guardianMatchingPacket?.stepRevisions[guardianSelectedStep!] ?? guardianSelectedRuntime?.revision ?? 1}{guardianMatchingPacket ? " · metadados do pacote Claude" : " · estado atual do servidor, sem pacote Claude associado"}</small>
            <label htmlFor="guardian-review">Parecer externo (mínimo 20 caracteres)<textarea id="guardian-review" value={guardianReview} onChange={(event) => setGuardianReview(event.target.value)} minLength={20} maxLength={48_000} rows={7} disabled={guardianImportLoading} required placeholder="Veredito, evidências, correção mínima, testes, riscos e limitações. Não inclua chaves, tokens ou senhas." /></label>
            <label className="guardian-source-acknowledgment"><input type="checkbox" checked={guardianManualSource} onChange={(event) => setGuardianManualSource(event.target.checked)} required disabled={guardianImportLoading} /><span>Confirmo que esta é uma importação humana, não uma execução API verificada e não uma autorização para avançar.</span></label>
            {guardianImportError && <p className="task-stale-warning" role="alert">{guardianImportError}</p>}
            {guardianImportNotice && <p className="guardian-import-notice" role="status">{guardianImportNotice}</p>}
            <button type="submit" disabled={guardianImportLoading || guardianReview.trim().length < 20 || !guardianManualSource}>{guardianImportLoading ? "Registrando parecer…" : "Registrar parecer sem aprovar fase"}</button>
            <small>Para o nó A6, somente um parecer da etapa e revisão correspondentes pode ser usado na retomada; a validação humana do output permanece separada.</small>
          </form> : <p>Abra uma missão para vincular um parecer externo à sua etapa e revisão.</p>}
        </section>
      </ModalFrame>}

      <footer>v0.7.0 — fases produzidas e validadas separadamente · outputs versionados · retomada auditável · sem reinício automático do zero.</footer>
    </main>
  );
}
