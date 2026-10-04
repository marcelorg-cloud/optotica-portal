"use client";

import { FormEvent, useState } from "react";

type RegentResponse = {
  mode?: string;
  output?: {
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
  error?: string;
  message?: string;
};

export default function Home() {
  const [objective, setObjective] = useState("");
  const [context, setContext] = useState("");
  const [budgetTier, setBudgetTier] = useState("minimal");
  const [result, setResult] = useState<RegentResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/regente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective, context, budgetTier }),
      });
      setResult(await response.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">REDE OPTÓTICA + ENSAVIM</span>
          <h1>Regente</h1>
          <p>Assessor de orquestração · v0.1 · modo consultivo</p>
        </div>
        <div className="status">● Advisory only</div>
      </header>

      <section className="grid">
        <form onSubmit={submit} className="panel">
          <h2>Nova decisão</h2>
          <label>
            Objetivo
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Ex.: definir a menor sequência para colocar a integração Meta em produção"
              required
            />
          </label>
          <label>
            Contexto opcional
            <textarea
              className="small"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Limites, dependências, urgência..."
            />
          </label>
          <label>
            Orçamento
            <select value={budgetTier} onChange={(e) => setBudgetTier(e.target.value)}>
              <option value="minimal">Mínimo</option>
              <option value="controlled">Controlado</option>
              <option value="flexible">Flexível</option>
            </select>
          </label>
          <button disabled={loading}>{loading ? "Orquestrando..." : "Consultar Regente"}</button>
        </form>

        <aside className="panel principles">
          <h2>Constituição v0.1</h2>
          <ol>
            <li>Mínimo suficiente</li>
            <li>Objetivo obrigatório</li>
            <li>Custo proporcional</li>
            <li>Não repetir trabalho</li>
            <li>Sem conversa pela conversa</li>
            <li>Escalonamento progressivo</li>
            <li>Autonomia conquistada</li>
            <li>Humano por exceção</li>
            <li>Rastreabilidade</li>
            <li>Kill switch</li>
          </ol>
        </aside>
      </section>

      {result && (
        <section className="panel result">
          {result.error ? (
            <>
              <h2>Configuração pendente</h2>
              <p>{result.message || result.error}</p>
            </>
          ) : result.output ? (
            <>
              <div className="resultHead">
                <div>
                  <span className={"pill " + result.output.status}>{result.output.status}</span>
                  <h2>{result.output.summary}</h2>
                </div>
                <div className="meta">
                  {result.output.priority} · {result.output.estimatedComplexity}
                </div>
              </div>
              <div className="nodes">
                {result.output.selectedNodes.map((node) => (
                  <span key={node}>{node}</span>
                ))}
              </div>
              <h3>Plano mínimo</h3>
              <ol className="actions">
                {result.output.actions.map((item) => (
                  <li key={item.step}>
                    <strong>{item.node}</strong> — {item.action}
                    <small>{item.reason}</small>
                  </li>
                ))}
              </ol>
              <h3>Sanidade</h3>
              <div className="checks">
                {result.output.sanityChecks.map((check) => (
                  <div key={check.rule}>
                    <strong>{check.status.toUpperCase()}</strong> {check.rule}
                    <small>{check.note}</small>
                  </div>
                ))}
              </div>
              {result.output.humanDecision && (
                <div className="human"><strong>Decisão humana:</strong> {result.output.humanDecision}</div>
              )}
            </>
          ) : null}
        </section>
      )}

      <footer>v0.1 — o Regente recomenda; ainda não executa ferramentas externas.</footer>
    </main>
  );
}
