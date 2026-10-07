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
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { void loadSessions(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

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
      setSessionId(id);
      setBudgetTier(payload.session.budget_tier || "minimal");
      setMessages(payload.messages || []);
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
  }

  async function refreshTaskStatus(taskId: string) {
    try {
      const response = await fetch(`/api/tasks/${taskId}/status`, { cache: "no-store" });
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
              steps: payload.steps || [],
            },
          },
        };
      }));

      return payload.task.status as string;
    } catch {
      return null;
    }
  }

  async function pollTaskUntilSettled(taskId: string) {
    const terminal = new Set(["succeeded", "blocked", "failed", "rejected", "needs_revision"]);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
      const status = await refreshTaskStatus(taskId);
      if (status && terminal.has(status)) {
        if (sessionId) await openSession(sessionId);
        return;
      }
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
              taskStatus: executionPayload.status || "queued",
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

        void pollTaskUntilSettled(taskId);
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
            <label className="budget-control">
              Orçamento
              <select value={budgetTier} onChange={(event) => setBudgetTier(event.target.value as Session["budget_tier"])}>
                <option value="minimal">Mínimo</option>
                <option value="controlled">Controlado</option>
                <option value="flexible">Flexível</option>
              </select>
            </label>
          </div>

          <div className="message-stream">
            {!messages.length && !loadingHistory && (
              <div className="chat-welcome">
                <span className="eyebrow">REGENTE v0.5</span>
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
                      <summary>Ver pipeline v0.5</summary>

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
                              {item.payload.runtime?.progressPercent ?? 0}% concluído
                            </span>
                          </div>
                          <progress
                            value={item.payload.runtime?.progressPercent ?? 0}
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
                        !["rejected", "approved", "succeeded"].includes(item.payload.taskStatus || "") && (
                          <div className="approval-gate">
                            <strong>Validação humana</strong>
                            <small>Revise o pipeline antes de liberar qualquer ação externa.</small>
                            <div className="approval-actions">
                              <button
                                type="button"
                                disabled={Boolean(decisionLoading)}
                                onClick={() => void decide(item.payload!.taskId!, "execute")}
                              >
                                Aprovar execução
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
            <div ref={bottomRef} />
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

      <footer>
        v0.6 — execução durável em segundo plano + checkpoints + retomada + auditoria + A5 Recovery Engineer.
      </footer>
    </main>
  );
}
