"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type PipelineStep = {
  step: number;
  role: "reference" | "planning" | "creative" | "critic" | "creation" | "picker" | "validation";
  nodes: string[];
  action: string;
  input: string;
  expectedOutput: string;
  executionState: "planned" | "ready" | "requires_adapter";
  requiresApproval: boolean;
  dependsOn?: number[];
  checkpoint?: boolean;
};

type RuntimeStep = {
  step_number: number;
  role?: string;
  node_ids?: string[];
  action?: string;
  status: "planned" | "prepared" | "awaiting_approval" | "running" | "review" | "succeeded" | "blocked" | "failed" | "skipped";
  depends_on: number[];
  attempt_count: number;
  last_error?: { message?: string } | null;
  next_action?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

type TaskRuntime = {
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
};

type PlanPayload = {
  message?: string;
  status: "proceed" | "needs_human" | "blocked";
  summary: string;
  objective: string;
  taskTitle?: string;
  priority: string;
  depth?: "direct" | "assisted" | "elaborated" | "deep";
  risk?: "low" | "medium" | "high";
  selectedNodes: string[];
  pipeline?: PipelineStep[];
  actions: { step: number; node: string; action: string; reason: string }[];
  picker?: {
    enabled: boolean;
    criteria: string[];
    variantsRequested: number;
    recommendationMode: "human_selects" | "regent_recommends_human_selects";
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

type OutputItem = {
  id: string;
  step: number;
  node: string;
  kind: string;
  source: string;
  status: string;
  createdAt?: string | null;
  content: string;
  links: string[];
};

type ChatMessage = {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  payload?: PlanPayload | null;
};

type Session = {
  id: string;
  title: string;
  budget_tier: "minimal" | "controlled" | "flexible";
  created_at: string;
  updated_at: string;
};

const TERMINAL_TASK_STATUSES = new Set(["succeeded", "blocked", "failed", "rejected", "needs_revision"]);

function taskStatusLabel(status?: string) {
  switch (status) {
    case "awaiting_approval": return "Aguardando autorização";
    case "approved": return "Preparada";
    case "executing": return "Em andamento";
    case "succeeded": return "Finalizada";
    case "blocked": return "Parada / bloqueada";
    case "failed": return "Parada / falhou";
    case "needs_revision": return "Aguardando revisão";
    case "rejected": return "Rejeitada";
    default: return status || "Preparando";
  }
}

async function readApiResponse(response: Response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!text) return {};
  if (contentType.includes("application/json")) {
    try { return JSON.parse(text); }
    catch {
      return { message: `Resposta JSON inválida (HTTP ${response.status}).`, raw: text.slice(0, 500) };
    }
  }
  try { return JSON.parse(text); }
  catch {
    return {
      message: `O servidor respondeu em formato inesperado (HTTP ${response.status}): ${text.slice(0, 300)}`,
      raw: text.slice(0, 500),
    };
  }
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
  const streamRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowBottomRef = useRef(true);
  const [outputsTaskId, setOutputsTaskId] = useState<string | null>(null);
  const [outputsTitle, setOutputsTitle] = useState("");
  const [outputsItems, setOutputsItems] = useState<OutputItem[]>([]);
  const [outputsLoading, setOutputsLoading] = useState(false);
  const [outputsError, setOutputsError] = useState("");
  const pollingTasksRef = useRef<Set<string>>(new Set());

  useEffect(() => { void loadSessions(); }, []);
  useEffect(() => {
    const stream = streamRef.current;
    if (stream && shouldFollowBottomRef.current) {
      stream.scrollTo({ top: stream.scrollHeight, behavior: "auto" });
    }
  }, [messages.length, loading, sessionId]);

  function trackScroll() {
    const stream = streamRef.current;
    if (!stream) return;
    shouldFollowBottomRef.current =
      stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
  }

  function goToMessageEdge(edge: "top" | "bottom") {
    const stream = streamRef.current;
    if (!stream) return;
    shouldFollowBottomRef.current = edge === "bottom";
    stream.scrollTo({ top: edge === "top" ? 0 : stream.scrollHeight, behavior: "smooth" });
  }

  async function showOutputs(taskId: string, title: string) {
    if (outputsTaskId === taskId) {
      setOutputsTaskId(null);
      return;
    }
    setOutputsTaskId(taskId);
    setOutputsTitle(title);
    setOutputsItems([]);
    setOutputsError("");
    setOutputsLoading(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/outputs`, { cache: "no-store" });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "Falha ao carregar outputs.");
      setOutputsItems((data.items || []) as OutputItem[]);
    } catch (err) {
      setOutputsError(err instanceof Error ? err.message : "Falha ao carregar outputs.");
    } finally {
      setOutputsLoading(false);
    }
  }

  async function loadSessions(selectLatest = true) {
    setLoadingHistory(true);
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      const payload = await readApiResponse(response);
      const list = (payload.sessions || []) as Session[];
      setSessions(list);
      if (selectLatest && !sessionId && list.length) await openSession(list[0].id);
    } catch {
      setError("Não foi possível carregar as conversas.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function openSession(id: string) {
    setLoadingHistory(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${id}/messages`, { cache: "no-store" });
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.message || "Falha ao abrir conversa.");
      const loadedMessages = (payload.messages || []) as ChatMessage[];
      if (sessionId !== id) shouldFollowBottomRef.current = true;
      setSessionId(id);
      setBudgetTier(payload.session.budget_tier || "minimal");
      setMessages(loadedMessages);

      const activeTaskIds = [...new Set(
        loadedMessages
          .filter((item) => item.payload?.taskId && item.payload.taskStatus === "executing")
          .map((item) => item.payload!.taskId as string),
      )];
      activeTaskIds.forEach((taskId) => void pollTaskUntilSettled(taskId, id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir a conversa.");
    } finally {
      setLoadingHistory(false);
    }
  }

  function newConversation() {
    setSessionId(null);
    setMessages([]);
    setMessage("");
    setBudgetTier("minimal");
    setError("");
    setOutputsTaskId(null);
  }

  async function refreshTaskStatus(taskId: string) {
    try {
      const response = await fetch(`/api/tasks/${taskId}/status?compact=1`, { cache: "no-store" });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.task) return null;

      setMessages((current) => current.map((item) => {
        if (item.payload?.taskId !== taskId) return item;
        return {
          ...item,
          payload: {
            ...item.payload,
            taskStatus: payload.task.status,
            runtime: {
              currentStep: payload.task.current_step,
              progressPercent: payload.task.progress_percent,
              nextAction: payload.task.next_action,
              autonomyLevel: payload.task.autonomy_level,
              blockedReason: payload.task.blocked_reason,
              lastError: payload.task.last_error,
              updatedAt: payload.task.updated_at,
              isStale: Boolean(payload.task.is_stale),
              lastActivityAt: payload.task.last_activity_at,
              steps: payload.steps || [],
            },
          },
        };
      }));

      return payload.task.is_stale ? "stale" : payload.task.status as string;
    } catch {
      return null;
    }
  }

  async function pollTaskUntilSettled(taskId: string, sessionToReload?: string | null) {
    if (pollingTasksRef.current.has(taskId)) return;
    pollingTasksRef.current.add(taskId);

    try {
      for (let attempt = 0; attempt < 480; attempt += 1) {
        const status = await refreshTaskStatus(taskId);
        if (status === "stale") return;
        if (status && TERMINAL_TASK_STATUSES.has(status)) {
          const targetSession = sessionToReload || sessionId;
          if (targetSession) await openSession(targetSession);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }
    } finally {
      pollingTasksRef.current.delete(taskId);
    }
  }

  async function resumeTask(taskId: string) {
    setDecisionLoading(taskId + "resume");
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.message || "Falha ao retomar o pipeline.");

      setMessages((current) => current.map((item) => {
        if (item.payload?.taskId !== taskId) return item;
        return {
          ...item,
          payload: {
            ...item.payload,
            taskStatus: payload.status || "executing",
            runtime: {
              ...(item.payload.runtime || {}),
              nextAction: "Execução retomada do último checkpoint válido.",
            },
          },
        };
      }));

      setMessages((current) => [
        ...current,
        {
          id: `resume-${Date.now()}`,
          role: "assistant",
          content: payload.message || "Execução retomada do último checkpoint válido.",
        },
      ]);

      void pollTaskUntilSettled(taskId, sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao retomar o pipeline.");
    } finally {
      setDecisionLoading("");
    }
  }

  async function decide(
    taskId: string,
    decision: "execute" | "partial" | "reject" | "revise",
    approvedSteps?: number[],
  ) {
    setDecisionLoading(taskId + decision);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, approvedSteps }),
      });
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.message || "Falha ao registrar decisão.");

      setMessages((current) => current.map((item) => {
        if (item.payload?.taskId !== taskId) return item;
        return {
          ...item,
          payload: { ...item.payload, taskStatus: payload.status },
        };
      }));

      setMessages((current) => [
        ...current,
        {
          id: `decision-${Date.now()}`,
          role: "assistant",
          content: payload.message,
        },
      ]);

      if ((decision === "execute" || decision === "partial") && payload.status === "approved") {
        const execution = await fetch(`/api/tasks/${taskId}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const executionPayload = await readApiResponse(execution);
        if (!execution.ok) throw new Error(executionPayload.message || "Falha ao iniciar o pipeline.");

        setMessages((current) => current.map((item) => {
          if (item.payload?.taskId !== taskId) return item;
          return {
            ...item,
            payload: {
              ...item.payload,
              taskStatus: executionPayload.status || "executing",
              runtime: {
                ...(item.payload.runtime || {}),
                nextAction:
                  "Execução em segundo plano iniciada. O painel pode ser fechado sem interromper o processamento.",
              },
            },
          };
        }));

        setMessages((current) => [
          ...current,
          {
            id: `workflow-${Date.now()}`,
            role: "assistant",
            content:
              executionPayload.message ||
              "Execução iniciada em segundo plano. Você pode fechar o painel.",
          },
        ]);

        void pollTaskUntilSettled(taskId, sessionId);
      }

      if (decision === "revise") {
        setMessage("Revise o último pipeline. ");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao registrar decisão.");
    } finally {
      setDecisionLoading(null);
    }
  }

  function approvePartial(payload: PlanPayload) {
    const steps = (payload.pipeline || []).map((item) => item.step);
    const answer = window.prompt(
      `Quais etapas deseja aprovar? Informe os números separados por vírgula. Disponíveis: ${steps.join(", ")}`,
      steps.slice(0, Math.min(2, steps.length)).join(","),
    );
    if (!answer || !payload.taskId) return;
    const selected = answer
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isInteger(value) && steps.includes(value));
    if (!selected.length) {
      setError("Nenhuma etapa válida foi selecionada.");
      return;
    }
    void decide(payload.taskId, "partial", selected);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || loading) return;

    const optimisticId = `local-${Date.now()}`;
    setMessages((current) => [...current, { id: optimisticId, role: "user", content: text }]);
    setMessage("");
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/regente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text, budgetTier }),
      });

      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.message || "Falha ao consultar o Regente.");

      setSessionId(payload.sessionId);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: payload.message,
          payload: payload.output,
        },
      ]);
      await loadSessions(false);
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setMessage(text);
      setError(err instanceof Error ? err.message : "Falha ao consultar o Regente.");
    } finally {
      setLoading(false);
    }
  }

  function renderMessageContent(content: string) {
    const parts = content.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, index) =>
      /^https?:\/\//.test(part) ? (
        <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="message-link">
          {part}
        </a>
      ) : (
        <span key={index}>{part}</span>
      ),
    );
  }

  const monitoredPayload = [...messages]
    .reverse()
    .find((item) => item.role === "assistant" && item.payload?.taskId)?.payload || null;
  const monitoredStepNumber = monitoredPayload?.runtime?.currentStep ?? null;
  const monitoredRuntimeStep = monitoredPayload?.runtime?.steps?.find(
    (step) => step.step_number === monitoredStepNumber,
  );
  const monitoredPipelineStep = monitoredPayload?.pipeline?.find(
    (step) => step.step === monitoredStepNumber,
  );
  const monitoredNodes =
    monitoredRuntimeStep?.node_ids?.length
      ? monitoredRuntimeStep.node_ids.join(", ")
      : monitoredPipelineStep?.nodes?.join(", ") || "—";
  const monitoredLoop =
    monitoredRuntimeStep?.role ||
    monitoredPipelineStep?.role ||
    (monitoredPayload?.taskStatus === "succeeded" ? "concluído" : "aguardando");
  const monitoredProgress = monitoredPayload?.taskStatus === "succeeded"
    ? 100
    : Math.max(0, Math.min(100, monitoredPayload?.runtime?.progressPercent ?? 0));
  const monitoredStale = monitoredPayload?.taskStatus === "executing" &&
    Boolean(monitoredPayload.runtime?.isStale);

  return (
    <main className="regent-app">
      <header className="regent-header">
        <div>
          <span className="eyebrow">REDE OPTÓTICA + ENSAVIM</span>
          <h1>Regente</h1>
          <p>v0.6 · execução durável · checkpoints · segundo plano · recovery A5</p>
        </div>
        <div className="status">● Human-gated execution</div>
      </header>

      <div className="chat-layout">
        <aside className="conversation-sidebar">
          <button className="new-chat-button" type="button" onClick={newConversation}>+ Nova conversa</button>
          <div className="conversation-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={session.id === sessionId ? "conversation-item active" : "conversation-item"}
                onClick={() => void openSession(session.id)}
              >
                <strong>{session.title}</strong>
                <small>{new Intl.DateTimeFormat("pt-BR", {
                  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                }).format(new Date(session.updated_at))}</small>
              </button>
            ))}
            {!sessions.length && !loadingHistory && <p className="empty-conversations">Nenhuma conversa ainda.</p>}
          </div>
        </aside>

        <section className="chat-panel">
          <div className="chat-toolbar">
            <div>
              <strong>{sessionId ? "Conversa atual" : "Nova conversa"}</strong>
              <small>O Regente mantém contexto e transforma decisões em tarefas auditáveis.</small>
            </div>
            <div className="chat-toolbar-actions">
              <div className="chat-nav-buttons" aria-label="Navegar na conversa">
                <button type="button" onClick={() => goToMessageEdge("top")} title="Ir ao início" aria-label="Ir ao início da conversa">↑ Topo</button>
                <button type="button" onClick={() => goToMessageEdge("bottom")} title="Ir ao fim" aria-label="Ir ao fim da conversa">↓ Fim</button>
              </div>
            <label className="budget-control">
              Orçamento
              <select value={budgetTier} onChange={(event) => setBudgetTier(event.target.value as Session["budget_tier"])}>
                <option value="minimal">Mínimo</option>
                <option value="controlled">Controlado</option>
                <option value="flexible">Flexível</option>
              </select>
            </label>
            </div>
          </div>

          <div className="message-stream" ref={streamRef} onScroll={trackScroll}>
            {!messages.length && !loadingHistory && (
              <div className="chat-welcome">
                <span className="eyebrow">REGENTE v0.6.2</span>
                <h2>Qual resultado precisamos produzir?</h2>
                <p>
                  O Regente decide a profundidade, combina referência, criatividade, crítica, criação e picker,
                  e para no gate humano antes de ações externas.
                </p>
              </div>
            )}

            {messages.map((item) => (
              <article key={item.id} className={`chat-message ${item.role}`}>
                <div className="message-author">{item.role === "user" ? "Você" : "Regente"}</div>
                <div className="message-bubble">
                  <p>{renderMessageContent(item.content)}</p>

                  {item.role === "assistant" && item.payload && (
                    <details className="plan-details" open={Boolean(item.payload.pipeline?.length)}>
                      <summary>Ver pipeline v0.6</summary>

                      <div className="plan-summary">
                        <div className="plan-meta-row">
                          <span className={`pill ${item.payload.status}`}>{item.payload.status}</span>
                          {item.payload.depth && <span className="pipeline-tag">profundidade: {item.payload.depth}</span>}
                          {item.payload.risk && <span className="pipeline-tag">risco: {item.payload.risk}</span>}
                          {item.payload.taskStatus && <span className="pipeline-tag">tarefa: {item.payload.taskStatus}</span>}
                        </div>
                        <strong>{item.payload.taskTitle || item.payload.summary}</strong>
                        <small>{item.payload.summary}</small>
                      </div>

                      {(item.payload.runtime || item.payload.nextAction) && (
                        <div className="picker-card">
                          <div className="pipeline-step-head">
                            <strong>Acompanhamento</strong>
                            <span className="pipeline-tag">
                              {item.payload.taskStatus === "succeeded" ? 100 : item.payload.runtime?.progressPercent ?? 0}% concluído
                            </span>
                          </div>
                          <progress
                            value={item.payload.taskStatus === "succeeded" ? 100 : item.payload.runtime?.progressPercent ?? 0}
                            max={100}
                            style={{ width: "100%" }}
                          />
                          <small>
                            <b>Etapa atual:</b> {item.payload.runtime?.currentStep ?? "aguardando execução"}
                          </small>
                          <small>
                            <b>Próxima ação:</b> {item.payload.runtime?.nextAction || item.payload.nextAction || "Aguardando definição."}
                          </small>
                          <small>
                            <b>Autonomia:</b> nível {item.payload.runtime?.autonomyLevel ?? item.payload.autonomyLevel ?? 1}
                          </small>
                          {item.payload.runtime?.isStale && (
                            <small className="task-stale-warning"><b>Atenção:</b> execução sem atualização há mais de 15 minutos. O percentual não indica conclusão.</small>
                          )}
                          {item.payload.runtime?.blockedReason && (
                            <small><b>Bloqueio:</b> {item.payload.runtime.blockedReason}</small>
                          )}
                        </div>
                      )}

                      {!!item.payload.selectedNodes?.length && (
                        <div className="nodes">
                          {item.payload.selectedNodes.map((node) => <span key={node}>{node}</span>)}
                        </div>
                      )}

                      {!!item.payload.pipeline?.length && (
                        <div className="pipeline-list">
                          {item.payload.pipeline.map((step) => {
                            const runtimeStep = item.payload?.runtime?.steps?.find((value) => value.step_number === step.step);
                            return (
                            <div className="pipeline-step" key={step.step}>
                              <div className="pipeline-step-head">
                                <strong>{step.step}. {step.role}</strong>
                                <span className={`execution-state ${runtimeStep?.status || step.executionState}`}>
                                  {runtimeStep?.status || step.executionState}
                                </span>
                              </div>
                              <p>{step.action}</p>
                              <small><b>Nós:</b> {step.nodes.join(", ")}</small>
                              <small><b>Entrada:</b> {step.input}</small>
                              <small><b>Saída esperada:</b> {step.expectedOutput}</small>
                              {!!step.dependsOn?.length && <small><b>Depende de:</b> {step.dependsOn.join(", ")}</small>}
                              {runtimeStep?.attempt_count ? <small><b>Tentativas:</b> {runtimeStep.attempt_count}</small> : null}
                              {runtimeStep?.last_error?.message ? <small><b>Último erro:</b> {runtimeStep.last_error.message}</small> : null}
                            </div>
                          )})}
                        </div>
                      )}

                      {item.payload.taskId && (
                        <button type="button" className="task-outputs-button" onClick={() => void showOutputs(item.payload!.taskId!, item.payload!.taskTitle || item.payload!.summary)}>
                          Ver todos os outputs ↗
                        </button>
                      )}

                      {item.payload.picker?.enabled && (
                        <div className="picker-card">
                          <strong>Picker supervisionado</strong>
                          <small>
                            {item.payload.picker.variantsRequested} variantes · critérios: {item.payload.picker.criteria.join(", ")}
                          </small>
                          <small>O Regente recomenda; a escolha final continua humana nesta fase.</small>
                        </div>
                      )}

                      {item.payload.taskId &&
                        item.payload.approvalRequired &&
                        item.payload.taskStatus === "awaiting_approval" && (
                          <div className="approval-gate">
                            <strong>Validação humana</strong>
                            <small>Uma autorização libera todas as etapas deste plano, inclusive as dependentes. Novas ações fora do plano continuam exigindo aprovação.</small>
                            <div className="approval-actions">
                              <button
                                type="button"
                                disabled={Boolean(decisionLoading)}
                                onClick={() => void decide(item.payload!.taskId!, "execute")}
                              >
                                Autorizar todas as etapas
                              </button>
                              <button
                                type="button"
                                className="secondary-action"
                                disabled={Boolean(decisionLoading)}
                                onClick={() => approvePartial(item.payload!)}
                              >
                                Executar parcialmente
                              </button>
                              <button
                                type="button"
                                className="secondary-action"
                                disabled={Boolean(decisionLoading)}
                                onClick={() => void decide(item.payload!.taskId!, "revise")}
                              >
                                Ajustar
                              </button>
                              <button
                                type="button"
                                className="danger-action"
                                disabled={Boolean(decisionLoading)}
                                onClick={() => void decide(item.payload!.taskId!, "reject")}
                              >
                                Rejeitar
                              </button>
                            </div>
                          </div>
                        )}

                      {item.payload.taskId && item.payload.taskStatus === "failed" && (
                        <div className="approval-gate">
                          <strong>Execução pausada</strong>
                          <small>Depois de corrigir o bloqueio, retome do último checkpoint sem repetir etapas já concluídas.</small>
                          <div className="approval-actions">
                            <button
                              type="button"
                              disabled={Boolean(decisionLoading)}
                              onClick={() => void resumeTask(item.payload!.taskId!)}
                            >
                              Retomar tarefa
                            </button>
                          </div>
                        </div>
                      )}
                    </details>
                  )}
                </div>
              </article>
            ))}

            {loading && (
              <article className="chat-message assistant">
                <div className="message-author">Regente</div>
                <div className="message-bubble typing">Montando o pipeline e aplicando a Constituição…</div>
              </article>
            )}
 
          </div>

          {error && <p className="chat-error">{error}</p>}

          <form onSubmit={submit} className="chat-composer">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Diga o resultado desejado. O Regente decide quantas camadas e ferramentas usar…"
              rows={3}
              required
            />
            <button disabled={loading || !message.trim()} type="submit">
              {loading ? "Orquestrando…" : "Enviar"}
            </button>
          </form>
        </section>
      </div>

      {monitoredPayload?.taskId && (
        <aside className={`task-live-monitor task-live-${monitoredPayload.taskStatus || "unknown"}`} aria-live="polite">
          <div className="task-live-head">
            <div>
              <span className="task-live-kicker">TAREFA ATUAL</span>
              <strong>{monitoredPayload.taskTitle || monitoredPayload.summary}</strong>
            </div>
            <span className="task-live-status">{taskStatusLabel(monitoredPayload.taskStatus)}</span>
          </div>
          <div className="task-live-progress-row">
            <progress value={monitoredProgress} max={100} />
            <b>{monitoredProgress}%</b>
          </div>
          {monitoredStale && (
            <small className="task-stale-warning">Sem atividade recente: possivelmente interrompida, não concluída.</small>
          )}
          <div className="task-live-grid">
            <span><b>Etapa</b>{monitoredStepNumber ?? "—"}</span>
            <span><b>Laço</b>{monitoredLoop}</span>
            <span><b>Nó</b>{monitoredNodes}</span>
          </div>
          <small className="task-live-next">
            <b>Agora:</b> {monitoredPayload.runtime?.nextAction || monitoredPayload.nextAction || "Aguardando próxima ação."}
          </small>
          <button type="button" className="task-monitor-outputs" onClick={() => void showOutputs(monitoredPayload.taskId!, monitoredPayload.taskTitle || monitoredPayload.summary)}>
            Outputs ↗
          </button>
        </aside>
      )}

      {outputsTaskId && (
        <div className="outputs-backdrop" onClick={() => setOutputsTaskId(null)}>
          <aside
            className="outputs-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Outputs da tarefa"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="outputs-drawer-head">
              <div>
                <span className="task-live-kicker">ARTEFATOS DA TAREFA</span>
                <strong>{outputsTitle}</strong>
              </div>
              <button type="button" onClick={() => setOutputsTaskId(null)} aria-label="Fechar outputs">✕</button>
            </div>
            {outputsLoading && <p>Carregando textos, imagens e arquivos da tarefa…</p>}
            {outputsError && <p className="task-stale-warning">{outputsError}</p>}
            {!outputsLoading && !outputsError && !outputsItems.length && (
              <p>Nenhum output registrado até agora.</p>
            )}
            <div className="outputs-list">
              {outputsItems.map((output) => (
                <article className="outputs-item" key={output.id}>
                  <div className="pipeline-step-head">
                    <strong>Etapa {output.step} · {output.node}</strong>
                    <span className="pipeline-tag">{output.source}</span>
                  </div>
                  <small>{output.kind} · {output.status}</small>
                  {!!output.links.length && (
                    <div className="outputs-links">
                      {output.links.map((link) => (
                        <a key={link} href={link} target="_blank" rel="noopener noreferrer">
                          {/\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(link) ? "Imagem" : /\.pdf(\?|#|$)/i.test(link) ? "PDF" : "Abrir arquivo/link"} ↗
                          {/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(link) && (
                            <img src={link} alt="Prévia do output" loading="lazy" />
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                  <details>
                    <summary>Visualizar texto/JSON</summary>
                    <pre>{output.content}</pre>
                  </details>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}

      <footer>
        v0.6.2 — estado vivo + monitor da tarefa + execução durável + checkpoints + A5 Recovery Engineer.
      </footer>
    </main>
  );
}
