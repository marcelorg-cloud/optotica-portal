'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { withCanvaRedo, withCanvaSession } from '@/lib/canva/navigation';

type Info = {
  templateUrl: string | null; templateReady: boolean; filename: string | null; designTitle: string; pageNumber: number | null; pageTitle: string | null;
  configured: boolean; configurationError: string | null; connected: boolean; hasDesign: boolean; hasResumableDesign: boolean; needsRecovery: boolean;
  productName: string; colorName: string; frameWidthMm: number | null;
  originalUrl: string | null; currentUrl: string | null; sourceChanged: boolean; recoverableSessionId: string | null;
};
type Result = {
  status?: string; sessionId?: string; previewUrl?: string; editUrl?: string; authorizeUrl?: string; message?: string;
};
const PROMPT = 'Considere as duas imagens selecionadas. A imagem menor, na parte superior, é a foto de origem: use exclusivamente o modelo de óculos dela e preserve fielmente formato, cor, material, proporções, espessura, ponte e detalhes. A imagem maior, abaixo, é somente a referência de posição, tamanho, escala, alinhamento, enquadramento, vista frontal e transparência; não copie o formato, a cor ou os detalhes do óculos de referência. Transforme o óculos da imagem menor em vista perfeitamente frontal. Remova completamente o fundo, as duas hastes laterais, as lentes, os reflexos e as sombras. Mantenha somente a parte frontal da armação e deixe o interior das lentes totalmente transparente. O resultado deve substituir a imagem maior e ocupar toda a largura horizontal disponível. As extremidades devem chegar às bordas da área transparente, sem cortes nem margens laterais. Amplie proporcionalmente, sem esticar ou deformar, preservando a centralização e o posicionamento vertical da referência. Entregue uma única armação frontal, com fundo totalmente transparente e contornos limpos. Não misture os modelos, não invente detalhes e não altere nenhuma característica do óculos da imagem menor.';
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
  const [pageNumber, setPageNumber] = useState('1');
  const [reviewed, setReviewed] = useState(false);
  const active = useRef<AbortController | null>(null);
  const productUrl = '/admin/catalogo/' + productId;
  const apiUrl = '/api/admin/catalog/canva';
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(apiUrl + '?' + new URLSearchParams({ productId, colorId }), { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível carregar esta cor.');
    setInfo(data);
    return data as Info;
  }, [productId, colorId]);
  const post = useCallback(async (action: string, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<Result> => {
    const response = await fetch(apiUrl, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, productId, colorId, ...extra }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
    return data;
  }, [productId, colorId]);

  const poll = useCallback(async (action: 'open' | 'redo' | 'export', sessionId: string | undefined, signal: AbortSignal) => {
    const deadline = Date.now() + 180000;
    let currentSessionId = sessionId;
    while (!signal.aborted) {
      const result = await post(action, currentSessionId ? { sessionId: currentSessionId } : {}, signal);
      currentSessionId = result.sessionId || currentSessionId;
      if (result.status !== 'processing') return { ...result, sessionId: result.sessionId || currentSessionId };
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
    setBusy('Importando a página desta cor…');
    const result = await poll('export', sessionId, signal);
    if (!result.previewUrl) throw new Error('O Canva não retornou uma prévia.');
    setPreview({ sessionId, url: result.previewUrl }); setReviewed(false);
    setSaved(result.status === 'saved');
    await refresh(signal);
  }, [poll, refresh]);

  const openFreshEditor = useCallback(async (sessionId: string, signal: AbortSignal) => {
    const result = await poll('redo', sessionId, signal);
    if (!result.editUrl || !result.sessionId) throw new Error('Não foi possível abrir o novo rascunho.');
    window.history.replaceState(window.history.state, '', withCanvaSession(window.location.href, result.sessionId));
    window.location.assign(result.editUrl);
  }, [poll]);

  useEffect(() => {
    function resume() {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setBusy('Atualizando a página do Canva…');
      void (async () => {
        try {
          const fresh = await refresh(controller.signal);
          const params = new URLSearchParams(window.location.search);
          const error = params.get('canva_error');
          if (error) setMessage(error);
          const redoId = params.get('redo');
          if (redoId) {
            setBusy('Recriando a página com as referências…');
            await openFreshEditor(redoId, controller.signal);
            return;
          }
          const sessionId = params.get('session') || fresh.recoverableSessionId;
          if (sessionId && !params.get('session')) {
            window.history.replaceState(window.history.state, '', withCanvaSession(window.location.href, sessionId));
          }
          if (sessionId) await importPreview(sessionId, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Falha de conexão.');
        } finally { if (!controller.signal.aborted) setBusy(''); }
      })();
    }
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resume();
    };
    resume();
    window.addEventListener('pageshow', handlePageShow);
    return () => { window.removeEventListener('pageshow', handlePageShow); active.current?.abort(); };
  }, [refresh, importPreview, openFreshEditor]);

  async function run(label: string, task: (signal: AbortSignal) => Promise<void>) {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(label); setMessage('');
    try { await task(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Falha de conexão.'); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  }
  function openEditor() {
    setPreview(null); setSaved(false); setReviewed(false);
    void run(info?.hasResumableDesign ? 'Concluindo o vínculo desta cor…' : 'Preparando o design desta cor…', async signal => {
      const result = await poll('open', undefined, signal);
      if (!result.editUrl || !result.sessionId) throw new Error('Não foi possível abrir o editor.');
      window.history.replaceState(window.history.state, '', withCanvaSession(window.location.href, result.sessionId));
      window.location.assign(result.editUrl);
    });
  }
  function redoEditor() {
    setPreview(null); setSaved(false); setReviewed(false);
    const sessionId = crypto.randomUUID();
    window.history.replaceState(window.history.state, '', withCanvaRedo(window.location.href, sessionId));
    void run('Recriando a página com as referências…', signal => openFreshEditor(sessionId, signal));
  }
  function importManually() {
    setPreview(null); setSaved(false); setReviewed(false);
    void run('Importando do Canva…', async signal => {
      const result = await post('import', {}, signal);
      if (!result.sessionId) throw new Error('Não foi possível iniciar a importação.');
      window.history.replaceState(window.history.state, '', withCanvaSession(window.location.href, result.sessionId));
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
        <p>Um design por produto, com uma página quadrada para cada cor. O portal exporta o PNG final em 540 × 540 px.</p>
        <p>Nome do design no Canva: <strong>{info.designTitle}</strong></p>
        {info.filename && <p>Nome do PNG desta cor: <strong>{info.filename}</strong></p>}
        {info.pageTitle && info.pageTitle !== info.filename && <p>O SKU ou a medida mudou desde a criação desta página. A exportação do portal usará o novo nome do PNG mostrado acima.</p>}
        <details>
          <summary>Imagem modelo da prova online</summary>
          <p>Esta imagem será usada como guia nas novas páginas. A foto original da cor será inserida separadamente no canto superior direito.</p>
          {info.templateUrl && <img src={info.templateUrl} alt="Imagem modelo cadastrada" style={{ ...previewStyle, maxWidth: 240 }} />}
          {!info.templateReady && <p role="status">{info.templateUrl ? 'A imagem cadastrada está com fundo branco ou sem transparência. Envie a versão com fundo e lentes transparentes.' : 'Cadastre o PNG modelo transparente de 540 × 540 px.'}</p>}
          <label>Substituir imagem modelo (PNG, 540 × 540 px)
            <input type="file" accept="image/png" disabled={!!busy} onChange={event => {
              const file = event.target.files?.[0]; if (!file) return;
              event.target.value = '';
              void run('Salvando imagem modelo…', async signal => {
                const form = new FormData(); form.append('file', file);
                const response = await fetch(apiUrl + '/template', { method: 'POST', body: form, signal });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || 'Não foi possível salvar o modelo.');
                await refresh(signal);
                setMessage(result.hasTransparency ? 'Imagem modelo cadastrada para as novas páginas.' : 'Modelo cadastrado, mas ainda precisa de transparência antes de criar páginas.');
              });
            }} />
          </label>
        </details>
        {!info.configured && <p role="alert" style={{ color: '#a32020' }}>{info.configurationError ||
          'A conexão com o Canva ainda precisa ser ativada pela administração da Optótica.'}</p>}
        {info.configured && !info.connected && <div>
          <p>Conecte sua conta Canva para preparar a foto desta cor. O PNG transparente exige um plano compatível, como Canva Pro.</p>
          <button type="button" className="button" disabled={!!busy} onClick={() => void run('Conectando ao Canva…', async signal => {
            const result = await post('connect', {}, signal);
            if (result.authorizeUrl) window.location.assign(result.authorizeUrl);
          })}>Conectar Canva</button>
        </div>}
        {info.sourceChanged && <p role="status">A foto original desta cor mudou desde a criação do design. Use <strong>Refazer com as referências</strong> para abrir uma página nova com a foto atual.</p>}
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
          <p>{info.hasDesign ? 'Para uma nova tentativa com as duas imagens, use Refazer com as referências. Para apenas ajustar o trabalho anterior, use Editar resultado atual.' : 'Crie a página desta cor e use o modelo como guia para posicionar a frente da armação real.'} No Canva, remova a foto pequena do canto e a armação usada como modelo. Deixe o fundo e o interior das lentes transparentes. Ao terminar, volte a esta página pelo botão Voltar do navegador; a importação começará automaticamente.</p>
          {info.hasResumableDesign && <p role="status">O design desta cor já existe no Canva. O portal concluirá o vínculo e abrirá esse mesmo design, sem criar outra página.</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {info.hasDesign ? <>
              <button type="button" className="button"
              disabled={!!busy || !info.originalUrl || !(Number(info.frameWidthMm) > 0) || !info.templateReady || !info.filename}
              onClick={redoEditor}>Refazer com as referências</button>
              <button type="button" className="button secondary" disabled={!!busy || !info.originalUrl || !(Number(info.frameWidthMm) > 0) || !info.filename}
                onClick={openEditor}>Editar resultado atual</button>
            </> : <button type="button" className="button" disabled={!!busy || !info.originalUrl || !(Number(info.frameWidthMm) > 0) || info.needsRecovery || (!info.hasResumableDesign && !info.templateReady) || !info.filename} onClick={openEditor}>
              {info.hasResumableDesign ? 'Concluir vínculo e abrir no Canva' : 'Criar página desta cor no Canva'}
            </button>}
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
            <summary>Vincular página existente</summary>
            <p>Informe o design do produto e o número da página desta cor. Confira a página no Canva antes de vincular.</p>
            <label>Link do design no Canva<input type="url" value={designUrl} onChange={event => setDesignUrl(event.target.value)} style={{ width: '100%' }} /></label>
            <label>Número da página<input type="number" min="1" max="500" value={pageNumber} onChange={event => setPageNumber(event.target.value)} /></label>
            <button type="button" className="button secondary small" disabled={!!busy || !designUrl || !pageNumber} onClick={() => void run('Vinculando design…', async signal => {
              await post('link', { designUrl, pageNumber }, signal); await refresh(signal);
            })}>Vincular a esta cor</button>
          </details>}
        </>}
        {preview && !saved && <div style={{ display: 'grid', gap: 10 }}>
          <p>Confira a cor, o formato da armação e a transparência dentro das lentes. Ao salvar, esta prévia passa a ser a foto de prova desta cor.</p>
          <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> Conferi: esta é a armação da cor correta, sem a foto pequena e sem a armação usada como modelo.</label>
          <button type="button" className="button" disabled={!!busy || !reviewed} onClick={() => void run('Salvando a foto de prova…', async signal => {
            await post('save', { sessionId: preview.sessionId }, signal); setSaved(true); await refresh(signal);
          })}>Salvar como foto de prova desta cor</button>
        </div>}
        {saved && <p role="status">Foto de prova salva. <Link href={productUrl + '#cor-' + colorId}>Voltar e preparar outra cor</Link>.</p>}
      </>}
    </section>
  );
}
