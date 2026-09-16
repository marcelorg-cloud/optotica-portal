'use client';

import { useCallback, useEffect, useState } from 'react';

// Fluxo de mensagens de WhatsApp por estágio do atendimento (16/09/2026).
// O profissional sempre comanda: abrir a prévia NÃO envia nada — só busca
// (de novo, ao vivo) qual das quatro mensagens se aplica agora e mostra o
// texto e os botões exatamente como o paciente vai receber. O envio em si
// só acontece depois de "Confirmar e enviar", e o servidor confere o
// estágio mais uma vez antes de mandar (ver a rota de API) — se algo mudou
// nesse intervalo (por exemplo, o pagamento acabou de ser confirmado), o
// envio é recusado e a prévia é atualizada em vez de mandar uma mensagem
// desatualizada.

type ButtonDef = { id: string; title: string };
type Preview = {
  stage: string | null;
  stageLabel?: string;
  body?: string;
  buttons?: ButtonDef[];
  isTestPatient: boolean;
  clientName?: string;
  blockedReason: string | null;
};

export function WhatsAppStagePanel({ orderId }: { orderId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('loading');
  const [sendState, setSendState] = useState<'idle' | 'confirming' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [testPatientSaving, setTestPatientSaving] = useState(false);

  // `loadPreview` é chamado a partir de manipuladores de evento (botão
  // "Atualizar prévia", depois de um envio, depois de trocar "paciente de
  // teste") — nesses casos, chamar setState de forma síncrona é normal.
  // O carregamento inicial (useEffect logo abaixo) NÃO passa por esta
  // função — usa uma cadeia de promises própria, sem nenhum setState
  // síncrono no corpo do efeito (mesmo padrão já usado em
  // components/catalog/catalog-review-queue.tsx), para não disparar o aviso
  // do eslint-plugin-react-hooks sobre setState síncrono dentro de efeito.
  const loadPreview = useCallback(async () => {
    setLoadState('loading');
    setSendState('idle');
    setErrorMessage('');
    try {
      const response = await fetch(`/api/professional/orders/${orderId}/whatsapp-stage`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) throw new Error(payload?.message || 'Não foi possível carregar a prévia.');
      setPreview(payload as Preview);
      setLoadState('idle');
    } catch (error) {
      setLoadState('error');
      setErrorMessage((error as Error).message);
    }
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/professional/orders/${orderId}/whatsapp-stage`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !payload) {
          setLoadState('error');
          setErrorMessage(payload?.message || 'Não foi possível carregar a prévia.');
          return;
        }
        setPreview(payload as Preview);
        setLoadState('idle');
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('error');
          setErrorMessage('Não foi possível carregar a prévia.');
        }
      });
    return () => { cancelled = true; };
  }, [orderId]);

  async function confirmSend() {
    if (!preview?.stage) return;
    setSendState('sending');
    setErrorMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/whatsapp-stage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: preview.stage })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setSendState('sent');
    } else {
      setSendState('error');
      setErrorMessage(payload.message || 'Não foi possível enviar a mensagem.');
      // O estágio pode ter mudado desde a prévia — recarrega para refletir a realidade atual.
      loadPreview();
    }
  }

  async function toggleTestPatient(value: boolean) {
    setTestPatientSaving(true);
    const response = await fetch(`/api/professional/orders/${orderId}/whatsapp-stage`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTestPatient: value })
    });
    if (response.ok) await loadPreview();
    setTestPatientSaving(false);
  }

  return (
    <section className="card step-section" id="whatsapp">
      <div className="card-head">
        <div className="step-title">
          <span className="step-badge">💬</span>
          <div><p className="eyebrow">Manual — o envio depende sempre da sua confirmação</p><h2>Mensagem de WhatsApp</h2></div>
        </div>
      </div>
      <div className="card-body stack">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={Boolean(preview?.isTestPatient)}
            disabled={testPatientSaving || loadState === 'loading'}
            onChange={(e) => toggleTestPatient(e.target.checked)}
          />
          Paciente de teste (permite cupom/desconto genérico — nunca usar com paciente real)
        </label>

        {loadState === 'loading' && <p>Consultando o estágio atual do atendimento…</p>}
        {loadState === 'error' && <p className="form-message error">{errorMessage || 'Não foi possível carregar a prévia.'}</p>}

        {loadState === 'idle' && preview && !preview.stage && (
          <div className="notice">{preview.blockedReason || 'Nenhuma mensagem se aplica a este atendimento agora.'}</div>
        )}

        {loadState === 'idle' && preview?.stage && (
          <div className="subsection stack">
            <div className="summary-row"><span>Estágio detectado</span><strong>{preview.stageLabel}</strong></div>
            <div className="whatsapp-preview">
              <p style={{ whiteSpace: 'pre-wrap' }}>{preview.body}</p>
              <div className="actions" style={{ flexWrap: 'wrap' }}>
                {(preview.buttons || []).map((button) => (
                  <span key={button.id} className="button secondary" style={{ pointerEvents: 'none' }}>{button.title}</span>
                ))}
              </div>
            </div>

            {sendState === 'sent' ? (
              <p className="form-message" style={{ color: 'var(--success)' }}>Mensagem enviada ✓</p>
            ) : sendState === 'sending' ? (
              <p>Enviando…</p>
            ) : sendState === 'confirming' ? (
              <div className="actions">
                <p style={{ margin: 0 }}>Enviar esta mensagem agora para o paciente?</p>
                <button className="button primary" type="button" onClick={confirmSend}>Confirmar e enviar</button>
                <button className="button secondary" type="button" onClick={() => setSendState('idle')}>Cancelar</button>
              </div>
            ) : (
              <div className="actions">
                <button className="button secondary" type="button" onClick={loadPreview}>Atualizar prévia</button>
                <button className="button primary" type="button" onClick={() => setSendState('confirming')}>Enviar mensagem</button>
              </div>
            )}
            {sendState === 'error' && <p className="form-message error">{errorMessage}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
