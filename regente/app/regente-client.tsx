"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type PlanPayload = {
  status: "proceed" | "needs_human" | "blocked";
  summary: string;
  objective: string;
  priority: string;
  selectedNodes: string[];
  actions: { step: number; node: string; action: string; reason: string }[];
  sanityChecks: { rule: string; status: string; note: string }[];
  estimatedComplexity: string;
  humanDecision: string | null;
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

export function RegenteClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [budgetTier, setBudgetTier] = useState<Session["budget_tier"]>("minimal");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function loadSessions(selectLatest = true) {
    setLoadingHistory(true);
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      const payload = await response.json();
      const list = (payload.sessions || []) as Session[];
      setSessions(list);

      if (selectLatest && !sessionId && list.length) {
        await openSession(list[0].id);
      }
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
      const response = await fetch(`/api/sessions/${id}/messages`, {
        cache: "no-store",
      });
      const payload = await response.json();
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || loading) return;

    const optimisticId = `local-${Date.now()}`;
    setMessages((current) => [
      ...current,
      { id: optimisticId, role: "user", content: text },
    ]);
    setMessage("");
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/regente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message: text,
          budgetTier,
        }),
      });

      const payload = await response.json();
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

  return (
    <main className="regent-app">
      <header className="regent-header">
        <div>
          <span className="eyebrow">REDE OPTÓTICA + ENSAVIM</span>
          <h1>Regente</h1>
          <p>v0.2 · conversa persistente · modo consultivo</p>
        </div>
        <div className="status">● Advisory only</div>
      </header>

      <div className="chat-layout">
        <aside className="conversation-sidebar">
          <button className="new-chat-button" type="button" onClick={newConversation}>
            + Nova conversa
          </button>

          <div className="conversation-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={session.id === sessionId ? "conversation-item active" : "conversation-item"}
                onClick={() => void openSession(session.id)}
              >
                <strong>{session.title}</strong>
                <small>
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(session.updated_at))}
                </small>
              </button>
            ))}
            {!sessions.length && !loadingHistory && (
              <p className="empty-conversations">Nenhuma conversa ainda.</p>
            )}
          </div>
        </aside>

        <section className="chat-panel">
          <div className="chat-toolbar">
            <div>
              <strong>{sessionId ? "Conversa atual" : "Nova conversa"}</strong>
              <small>O Regente lembra o histórico desta sessão.</small>
            </div>
            <label className="budget-control">
              Orçamento
              <select
                value={budgetTier}
                onChange={(event) =>
                  setBudgetTier(event.target.value as Session["budget_tier"])
                }
              >
                <option value="minimal">Mínimo</option>
                <option value="controlled">Controlado</option>
                <option value="flexible">Flexível</option>
              </select>
            </label>
          </div>

          <div className="message-stream">
            {!messages.length && !loadingHistory && (
              <div className="chat-welcome">
                <span className="eyebrow">REGENTE v0.2</span>
                <h2>O que precisamos decidir?</h2>
                <p>
                  Esta conversa mantém contexto. Depois da primeira resposta, você pode dizer
                  “critique isso”, “continue”, “reduza para duas ações” ou “execute só a etapa 1”.
                </p>
              </div>
            )}

            {messages.map((item) => (
              <article key={item.id} className={`chat-message ${item.role}`}>
                <div className="message-author">
                  {item.role === "user" ? "Você" : "Regente"}
                </div>
                <div className="message-bubble">
                  <p>{item.content}</p>
                  {item.role === "assistant" && item.payload && (
                    <details className="plan-details">
                      <summary>Ver plano e sanidade</summary>
                      <div className="plan-summary">
                        <span className={`pill ${item.payload.status}`}>
                          {item.payload.status}
                        </span>
                        <strong>{item.payload.summary}</strong>
                        <small>
                          {item.payload.priority} · {item.payload.estimatedComplexity}
                        </small>
                      </div>
                      {!!item.payload.selectedNodes?.length && (
                        <div className="nodes">
                          {item.payload.selectedNodes.map((node) => (
                            <span key={node}>{node}</span>
                          ))}
                        </div>
                      )}
                      {!!item.payload.actions?.length && (
                        <>
                          <h3>Plano mínimo</h3>
                          <ol className="actions">
                            {item.payload.actions.map((action) => (
                              <li key={action.step}>
                                <strong>{action.node}</strong> — {action.action}
                                <small>{action.reason}</small>
                              </li>
                            ))}
                          </ol>
                        </>
                      )}
                    </details>
                  )}
                </div>
              </article>
            ))}

            {loading && (
              <article className="chat-message assistant">
                <div className="message-author">Regente</div>
                <div className="message-bubble typing">Analisando a continuidade…</div>
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
              placeholder="Fale com o Regente…"
              rows={3}
              required
            />
            <button disabled={loading || !message.trim()} type="submit">
              {loading ? "Enviando…" : "Enviar"}
            </button>
          </form>
        </section>
      </div>

      <footer>
        v0.2 — histórico persistente por sessão; o Regente ainda não executa ferramentas externas.
      </footer>
    </main>
  );
}
