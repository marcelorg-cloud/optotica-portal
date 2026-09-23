'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Info = {
  configured: boolean; connected: boolean; hasDesign: boolean; needsRecovery: boolean;
  productName: string; colorName: string; frameWidthMm: number | null;
  originalUrl: string | null; currentUrl: string | null; sourceChanged: boolean;
};
type Result = {
  status?: string; sessionId?: string; previewUrl?: string; editUrl?: string; authorizeUrl?: string; message?: string;
};
const PROMPT = 'Prepare esta armação para prova virtual. Mantenha somente a parte frontal. Remova as hastes, o fundo, as sombras externas e os reflexos das lentes. Deixe o fundo e o interior das lentes totalmente transparentes. Preserve fielmente a cor, a espessura e o desenho da armação. Nivele e centralize os óculos. Mantenha apenas esta imagem na primeira página, sem textos ou outros elementos.';
const previewStyle = {
  width: '100%', maxWidth: 440, aspectRatio: '1 / 1', objectFit: 'contain' as const,
  border: '1px solid var(--line)', borderRadius: 8,
  background: 'repeating-conic-gradient(#e8e8e8 0% 25%, #fff 0% 50%) 50% / 24px 24px'
};

export function CanvaTryonWorkspace({ productId, colorId }: { productId: string; colorId: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ url: string; sessionId: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [designUrl, setDesignUrl] = useState('');
  const active = useRef<AbortController | null>(null);
  const productUrl = '/admin/catalogo/' + productId;
  const apiUrl = '/api/admin/catalog/canva';
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(apiUrl + '?' + new URLSearchParams({ productId, colorId }), { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível carregar esta cor.');
    setInfo(data);
  }, [productId, colorId]);
  const post = useCallback(async (action: string, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<Result> => {
    const response = await fetch(apiUrl, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, productId, colorId, ...extra }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
    return data;
  }, [productId, colorId]);

  const poll = useCallback(async (action: 'open' | 'export', sessionId: string | undefined, signal: AbortSignal) => {
    const deadline = Date.now() + 180000;
    while (!signal.aborted) {
      const result = await post(action, sessionId ? { sessionId } : {}, signal);
      if (result.status !== 'processing') return result;
      if (Date.now() >= deadline) throw new Error('O Canva ainda está processando. Aguarde um pouco e tente novamente.');
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 2000);
        signal.addEventListener('abort', stop, { once: true });
      });
    }
    throw new DOMException('Aborted', 'AbortError');
  }, [post]);

  const importPreview = useCallback(async (sessionId: string, signal: AbortSignal) => {
    setBusy('Importando a primeira página do Canva…');
    const result = await poll('export', sessionId, signal);
    if (!result.previewUrl) throw new Error('O Canva não retornou uma prévia.');
    setPreview({ sessionId, url: result.previewUrl });
    setSaved(result.status === 'saved');
    await refresh(signal);
  }, [poll, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    async function start() {
      try {
        await refresh(controller.signal);
        const params = new URLSearchParams(window.location.search);
        const error = params.get('canva_error');
        if (error) setMessage(error);
        const sessionId = params.get('session');
        if (sessionId) await importPreview(sessionId, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Falha de conexão.');
      } finally { if (!controller.signal.aborted) setBusy(''); }
    }
    void start();
    return () => { controller.abort(); active.current?.abort(); };
  }, [refresh, importPreview]);

  async function run(label: string, task: (signal: AbortSignal) => Promise<void>) {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(label); setMessage('');
    try { await task(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Falha de conexão.'); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  }
  function openEditor() {
    void run('Preparando o design desta cor…', async signal => {
      const result = await poll('open', undefined, signal);
      if (!result.editUrl) throw new Error('Não foi possível abrir o editor.');
      window.location.assign(result.editUrl);
    });
  }
  function importManually() {
    void run('Importando do Canva…', async signal => {
      const result = await post('import', {}, signal);
      if (!result.sessionId) throw new Error('Não foi possível iniciar a importação.');
      const url = new URL(window.location.href); url.searchParams.set('session', result.sessionId);
      window.history.replaceState(null, '', url.toString());
      await importPreview(result.sessionId, signal);
    });
  }
  return (
    <section className="card" style={{ padding: 24, display: 'grid', gap: 20 }}>
      <Link href={productUrl + '#cor-' + colorId}>← Voltar ao produto</Link>
      <header>
        <h1>Foto de prova no Canva</h1>
        <p>{info ? info.productName + ' — ' + info.colorName : 'Carregando a cor…'}</p>
      </header>
      {message && <p role="alert" style={{ color: '#a32020' }}>{message}</p>}
      {busy && <p role="status" aria-live="polite">{busy}</p>}
      {info && <>
        {!info.configured && <p>A conexão com o Canva ainda precisa ser ativada pela administração da Optótica.</p>}
        {info.configured && !info.connected && <div>
          <p>Conecte sua conta Canva para preparar a foto desta cor. O PNG transparente exige um plano compatível, como Canva Pro.</p>
          <button type="button" className="button" disabled={!!busy} onClick={() => void run('Conectando ao Canva…', async signal => {
            const result = await post('connect', {}, signal);
            if (result.authorizeUrl) window.location.assign(result.authorizeUrl);
          })}>Conectar Canva</button>
        </div>}
        {info.sourceChanged && <p role="status">A foto original desta cor mudou desde a criação do design. Confira e, se necessário, substitua a imagem dentro do Canva.</p>}
        {!(Number(info.frameWidthMm) > 0) && <p>Preencha e salve a <strong>Frente Total (mm)</strong> no <Link href={productUrl}>cadastro do produto</Link> antes de continuar.</p>}
        {Number(info.frameWidthMm) > 0 && <p>Frente total cadastrada: <strong>{info.frameWidthMm} mm</strong>.</p>}
        {!info.originalUrl && <p>Cadastre a foto original desta cor no produto.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 24 }}>
          <div>
            <h2>Foto original da cor</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {info.originalUrl && <img src={info.originalUrl} alt={'Foto original — ' + info.colorName} style={{ ...previewStyle, background: '#fff' }} />}
          </div>
          <div>
            <h2>{preview ? 'Prévia para salvar' : 'Foto de prova atual'}</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {(preview?.url || info.currentUrl) ? <img src={preview?.url || info.currentUrl || ''} alt={'Foto de prova — ' + info.colorName} style={previewStyle} /> : <p>Ainda sem foto de prova.</p>}
          </div>
        </div>
        {info.configured && info.connected && <>
          <p>Edite a <strong>primeira página</strong>: mantenha só a frente da armação e deixe o fundo e o interior das lentes transparentes. Ao terminar, use o botão de retorno à Optótica no Canva.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="button" disabled={!!busy || !info.originalUrl || !(Number(info.frameWidthMm) > 0) || info.needsRecovery} onClick={openEditor}>
              {info.hasDesign ? 'Editar no Canva' : 'Criar foto de prova no Canva'}
            </button>
            {info.hasDesign && <button type="button" className="button secondary" disabled={!!busy} onClick={importManually}>Importar do Canva</button>}
            <button type="button" className="text-button" disabled={!!busy} onClick={() => void run('Conectando…', async signal => {
              const result = await post('connect', {}, signal);
              if (result.authorizeUrl) window.location.assign(result.authorizeUrl);
            })}>Reconectar conta</button>
          </div>
          <details>
            <summary>Comando sugerido para a edição</summary>
            <p>Copie e use no editor do Canva, se o recurso estiver disponível na sua conta.</p>
            <textarea aria-label="Comando para editar a armação no Canva" readOnly value={PROMPT} rows={5} style={{ width: '100%' }} />
            <button type="button" className="button secondary small" onClick={async () => {
              try { await navigator.clipboard.writeText(PROMPT); setMessage('Comando copiado.'); }
              catch { setMessage('Selecione o texto acima e copie o comando.'); }
            }}>Copiar comando</button>
          </details>
          {!info.hasDesign && <details open={info.needsRecovery || undefined}>
            <summary>Vincular design existente</summary>
            <p>Use um design da sua conta que contenha apenas a foto de prova desta cor na primeira página.</p>
            <label>Link do design no Canva<input type="url" value={designUrl} onChange={event => setDesignUrl(event.target.value)} style={{ width: '100%' }} /></label>
            <button type="button" className="button secondary small" disabled={!!busy || !designUrl} onClick={() => void run('Vinculando design…', async signal => {
              await post('link', { designUrl }, signal); await refresh(signal);
            })}>Vincular a esta cor</button>
          </details>}
        </>}
        {preview && !saved && <div style={{ display: 'grid', gap: 10 }}>
          <p>Confira a cor, o formato da armação e a transparência dentro das lentes. Ao salvar, esta prévia passa a ser a foto de prova desta cor.</p>
          <button type="button" className="button" disabled={!!busy} onClick={() => void run('Salvando a foto de prova…', async signal => {
            await post('save', { sessionId: preview.sessionId }, signal); setSaved(true); await refresh(signal);
          })}>Salvar como foto de prova desta cor</button>
        </div>}
        {saved && <p role="status">Foto de prova salva. <Link href={productUrl + '#cor-' + colorId}>Voltar e preparar outra cor</Link>.</p>}
      </>}
    </section>
  );
}
