'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Color = { id: string; name: string; variant: number | null; filename: string | null;
  hasOriginal: boolean; hasResult: boolean; pageNumber: number | null; hasPage: boolean; stale: boolean; stage: string | null;
  prompt: string; refinementPrompt: string; originalUrl: string | null; formatUrl: string | null; currentUrl: string | null };
type Batch = { productName: string; sku: string; connected: boolean; configured: boolean; configurationError: string | null;
  hasMeasurements: boolean; templateReady: boolean; pendingColorId: string | null; prompt: string; colors: Color[] };
type Result = { status?: string; sessionId?: string; previewUrl?: string; editUrl?: string; authorizeUrl?: string; message?: string };
type Preview = { sessionId: string; url: string; saved: boolean };

const delay = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(new DOMException('Cancelado', 'AbortError')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 2000);
  signal.addEventListener('abort', stop, { once: true });
});

export function CanvaBatchWorkspace({ productId }: { productId: string }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const active = useRef<AbortController | null>(null);
  const sessions = useRef<Record<string, string>>({});
  const storageKey = `canva-batch-sessions:${productId}`;
  const productUrl = `/admin/catalogo/${productId}`;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/admin/catalog/canva/batch?productId=${encodeURIComponent(productId)}`,
      { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível carregar as cores.');
    setBatch(data as Batch);
    return data as Batch;
  }, [productId]);
  useEffect(() => {
    try { sessions.current = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch { sessions.current = {}; }
    const canvaError = new URLSearchParams(window.location.search).get('canva_error');
    const controller = new AbortController();
    queueMicrotask(() => {
      if (canvaError && !controller.signal.aborted) setMessage(canvaError);
      if (!controller.signal.aborted) void refresh(controller.signal)
        .catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    });
    return () => { controller.abort(); active.current?.abort(); };
  }, [refresh, storageKey]);

  const post = useCallback(async (url: string, action: string, colorId?: string, sessionId?: string,
    signal?: AbortSignal): Promise<Result> => {
    const response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, action, ...(colorId ? { colorId } : {}), ...(sessionId ? { sessionId } : {}) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
    return data;
  }, [productId]);

  async function run(label: string, task: (signal: AbortSignal) => Promise<void>) {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(label); setMessage('');
    try { await task(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Falha de conexão.'); }
    finally { if (!controller.signal.aborted) setBusy(''); }
  }
  const eligible = batch?.colors.filter(color => color.hasOriginal && color.filename && !color.stale) || [];
  const allReady = eligible.length > 0 && eligible.every(color => color.hasPage || progress[color.id] === 'Página pronta');
  const canPrepare = !!batch?.connected && batch.hasMeasurements && batch.templateReady && eligible.length > 0;

  function prepareAll() {
    if (!canPrepare) return;
    void run('Preparando páginas…', async signal => {
      const ordered = [...eligible].sort((a, b) => Number(b.id === batch?.pendingColorId) - Number(a.id === batch?.pendingColorId));
      for (const [index, color] of ordered.entries()) {
        if (color.hasPage) {
          setProgress(previous => ({ ...previous, [color.id]: 'Página pronta' }));
          continue;
        }
        setBusy(`Preparando ${index + 1}/${eligible.length}: ${color.name}`);
        setProgress(previous => ({ ...previous, [color.id]: 'Preparando…' }));
        const deadline = Date.now() + 180000;
        while (!signal.aborted) {
          const result = await post('/api/admin/catalog/canva/batch', 'prepare', color.id, undefined, signal);
          if (result.status === 'ready') break;
          if (Date.now() >= deadline) throw new Error(`A página de ${color.name} ainda está sendo preparada. Clique de novo para retomar.`);
          await delay(signal);
        }
        setProgress(previous => ({ ...previous, [color.id]: 'Página pronta' }));
      }
      await refresh(signal);
      setMessage('Todas as cores disponíveis foram preparadas no mesmo design. Abra o Canva em uma nova aba e trabalhe cada página com a referência de formato em cima e a cor embaixo.');
    });
  }

  function editAll() {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    void run('Abrindo o design…', async signal => {
      try {
        const result = await post('/api/admin/catalog/canva/batch', 'edit', undefined, undefined, signal);
        if (!result.editUrl) throw new Error('Não foi possível abrir o design.');
        if (!popup) throw new Error('O navegador bloqueou a nova aba. Permita pop-ups para este portal e tente novamente.');
        popup.location.replace(result.editUrl);
      } catch (error) { popup?.close(); throw error; }
    });
  }

  function resetAll() {
    if (!window.confirm('Refazer todas as cores com as referências atuais?\n\nO design antigo continuará preservado no Canva, mas o portal criará um novo lote para este produto.')) return;
    void run('Reiniciando o lote…', async signal => {
      await post('/api/admin/catalog/canva/batch', 'reset', undefined, undefined, signal);
      sessions.current = {}; sessionStorage.removeItem(storageKey);
      setPreviews({}); setReviewed({}); setProgress({});
      await refresh(signal);
      setMessage('Lote reiniciado. Clique em Preparar todas as cores para criar o novo design com as referências atuais.');
    });
  }

  function importAll() {
    void run('Importando prévias…', async signal => {
      const latest = await refresh(signal);
      const colors = latest.colors.filter(color => color.hasPage && !color.stale && color.hasOriginal);
      if (!colors.length) throw new Error('Ainda não há páginas prontas para importar.');
      const failures: string[] = [];
      for (const [index, color] of colors.entries()) {
        setBusy(`Importando ${index + 1}/${colors.length}: ${color.name}`);
        const current = previews[color.id];
        if (current?.saved) continue;
        try {
          let sessionId = current?.sessionId || sessions.current[color.id];
          if (!sessionId) {
            const started = await post('/api/admin/catalog/canva', 'import', color.id, undefined, signal);
            if (!started.sessionId) throw new Error('Não foi possível iniciar a importação.');
            sessionId = started.sessionId;
            sessions.current[color.id] = sessionId;
            sessionStorage.setItem(storageKey, JSON.stringify(sessions.current));
          }
          const deadline = Date.now() + 180000;
          while (!signal.aborted) {
            const result = await post('/api/admin/catalog/canva', 'export', color.id, sessionId, signal);
            if (result.previewUrl) {
              setPreviews(previous => ({ ...previous, [color.id]: { sessionId, url: result.previewUrl!, saved: result.status === 'saved' } }));
              setProgress(previous => ({ ...previous, [color.id]: result.status === 'saved' ? 'Salva' : 'Prévia pronta para conferir' }));
              break;
            }
            if (result.status !== 'processing' || Date.now() >= deadline) {
              throw new Error('A exportação ainda não terminou. Clique em Importar para retomar.');
            }
            await delay(signal);
          }
        } catch (error) {
          if (signal.aborted) throw error;
          const detail = error instanceof Error ? error.message : 'Falha de conexão.';
          setProgress(previous => ({ ...previous, [color.id]: `Falha: ${detail}` }));
          failures.push(color.name);
        }
      }
      setMessage(failures.length
        ? `Confira as prévias disponíveis. Falharam: ${failures.join(', ')}. Corrija essas páginas e clique em Importar novamente.`
        : 'Confira cada prévia e marque apenas as cores corretas antes de salvar.');
    });
  }

  function saveReviewed() {
    void run('Salvando fotos conferidas…', async signal => {
      const colors = batch?.colors.filter(color => reviewed[color.id] && previews[color.id] && !previews[color.id].saved) || [];
      if (!colors.length) throw new Error('Marque ao menos uma prévia conferida.');
      for (const color of colors) {
        setBusy(`Salvando ${color.name}…`);
        await post('/api/admin/catalog/canva', 'save', color.id, previews[color.id].sessionId, signal);
        setPreviews(previous => ({ ...previous, [color.id]: { ...previous[color.id], saved: true } }));
        setProgress(previous => ({ ...previous, [color.id]: 'Salva' }));
        delete sessions.current[color.id];
        sessionStorage.setItem(storageKey, JSON.stringify(sessions.current));
      }
      await refresh(signal);
      setMessage('Fotos conferidas salvas nas cores correspondentes.');
    });
  }

  return <section className="card" style={{ padding: 24, display: 'grid', gap: 20 }}>
    <Link href={productUrl}>← Voltar ao produto</Link>
    <header><h1>Fotos de prova no Canva — todas as cores</h1>
      <p>{batch ? `${batch.productName} — ${batch.sku}` : 'Carregando produto…'}</p></header>
    {message && <p role="status">{message}</p>}
    {batch && <>
      {!batch.configured && <p role="alert">{batch.configurationError}</p>}
      {!batch.connected && batch.configured && <div><p>Conecte sua conta Canva para começar.</p>
        <button type="button" className="button" disabled={!!busy || !batch.colors[0]} onClick={() => void run('Conectando ao Canva…', async signal => {
          const result = await post('/api/admin/catalog/canva/batch', 'connect', batch.colors[0].id, undefined, signal);
          if (!result.authorizeUrl) throw new Error('Não foi possível iniciar a conexão.');
          window.location.assign(result.authorizeUrl);
        })}>Conectar Canva</button></div>}
      {batch.connected && batch.configured && <div>
        <p>O Regente usa esta mesma conexão Canva do portal. Para atualizar a conta ou equipe, autorize novamente com a conta desejada.</p>
        <button type="button" className="button secondary" disabled={!!busy || !batch.colors[0]} onClick={() => void run('Atualizando conexão Canva…', async signal => {
          const result = await post('/api/admin/catalog/canva/batch', 'connect', batch.colors[0].id, undefined, signal);
          if (!result.authorizeUrl) throw new Error('Não foi possível iniciar a conexão.');
          window.location.assign(result.authorizeUrl);
        })}>Trocar conta Canva</button>
      </div>}
      {!batch.hasMeasurements && <p>Cadastre a referência de formato e proporções do modelo antes de preparar o lote.</p>}
      {!batch.templateReady && <p>Cadastre a imagem modelo transparente na página de uma cor antes de preparar o lote.</p>}
      <p>Esta é a página única do produto. Cada cor abaixo reúne suas referências e seus dois comandos. No Canva, cada cor continua em uma página quadrada própria dentro do mesmo design, porque assim o portal consegue importar o PNG correto de cada cor.</p>
      <p>A referência visual do formato fica grande na parte superior e deve ser uma imagem limpa, recortada e sem setas, números ou cotas. A foto real da cor fica grande na parte inferior. Mantenha as duas durante o refinamento e remova-as somente antes de importar.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button type="button" className="button" disabled={!!busy || !canPrepare} onClick={prepareAll}>Preparar todas as cores</button>
        <button type="button" className="button secondary" disabled={!!busy || !allReady} onClick={editAll}>Abrir design no Canva</button>
        <button type="button" className="button secondary" disabled={!!busy || !batch.colors.some(color => color.hasPage && !color.stale)} onClick={importAll}>Importar todas as páginas prontas</button>
        <button type="button" className="button secondary" disabled={!!busy || !batch.colors.some(color => color.hasPage)} onClick={resetAll}>Refazer todas com novas referências</button>
      </div>
      {busy && <p role="status">{busy}</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {batch.colors.map(color => <div key={color.id} id={`cor-${color.id}`} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <strong>{color.variant ? `C${color.variant} — ` : ''}{color.name}</strong>
            <span>{color.filename || 'Informe o SKU, número da cor e Frente Total'}</span>
          </div>
          <p style={{ margin: 0 }}>{progress[color.id] || (color.stale ? 'Referências mudaram: use Refazer todas com novas referências' : color.hasPage ? `Página ${color.pageNumber || 'vinculada'} no Canva` : color.hasOriginal ? 'Aguardando preparação' : 'Cadastre a foto da cor')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16 }}>
            <div><strong>Referência visual limpa do formato</strong>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {color.formatUrl ? <img src={color.formatUrl} alt={`Formato do modelo — ${batch.productName}`} style={{ width: '100%', maxHeight: 360, objectFit: 'contain', background: '#fff', marginTop: 8 }} /> : <p>Cadastre a referência do formato.</p>}
            </div>
            <div><strong>Foto real desta cor</strong>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {color.originalUrl ? <img src={color.originalUrl} alt={`Foto real — ${color.name}`} style={{ width: '100%', maxHeight: 360, objectFit: 'contain', background: '#fff', marginTop: 8 }} /> : <p>Cadastre a foto desta cor.</p>}
            </div>
            {color.currentUrl && <div><strong>Foto de prova atual</strong>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={color.currentUrl} alt={`Foto de prova — ${color.name}`} style={{ width: '100%', maxHeight: 360, objectFit: 'contain', marginTop: 8 }} /></div>}
          </div>
          <details open><summary>1º comando — gerar esta cor</summary>
            <textarea aria-label={`Comando para gerar ${color.name}`} readOnly value={color.prompt} rows={16} style={{ width: '100%' }} />
            <button type="button" className="button secondary small" onClick={async () => {
              try { await navigator.clipboard.writeText(color.prompt); setMessage(`Comando de ${color.name} copiado.`); }
              catch { setMessage('Selecione o texto e copie o comando.'); }
            }}>Copiar comando desta cor</button>
          </details>
          <details><summary>2º comando — refinar esta cor</summary>
            <textarea aria-label={`Comando para refinar ${color.name}`} readOnly value={color.refinementPrompt} rows={11} style={{ width: '100%' }} />
            <button type="button" className="button secondary small" onClick={async () => {
              try { await navigator.clipboard.writeText(color.refinementPrompt); setMessage(`Comando de refinamento de ${color.name} copiado.`); }
              catch { setMessage('Selecione o texto e copie o comando.'); }
            }}>Copiar refinamento</button>
          </details>
          {progress[color.id]?.startsWith('Falha:') && <button type="button" className="text-button" disabled={!!busy} onClick={() => {
            delete sessions.current[color.id];
            sessionStorage.setItem(storageKey, JSON.stringify(sessions.current));
            setProgress(previous => ({ ...previous, [color.id]: 'Importação reiniciada; clique em Importar novamente.' }));
          }}>Reiniciar importação desta cor</button>}
          {previews[color.id] && <div style={{ display: 'grid', gap: 8, maxWidth: 300 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previews[color.id].url} alt={`Prévia da foto de prova — ${color.name}`} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'contain', border: '1px solid var(--line)', background: 'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 20px 20px' }} />
            {previews[color.id].saved ? <strong>Salva nesta cor</strong> : <label>
              <input type="checkbox" checked={!!reviewed[color.id]} onChange={event => setReviewed(previous => ({ ...previous, [color.id]: event.target.checked }))} /> Conferi que esta armação e cor correspondem à página {color.filename} e têm transparência real.
            </label>}
          </div>}
        </div>)}
      </div>
      {Object.values(previews).some(item => !item.saved) && <button type="button" className="button" disabled={!!busy || !Object.keys(reviewed).some(id => reviewed[id] && previews[id] && !previews[id].saved)} onClick={saveReviewed}>Salvar fotos conferidas</button>}
    </>}
  </section>;
}
