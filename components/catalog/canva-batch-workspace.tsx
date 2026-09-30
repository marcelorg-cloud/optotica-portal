'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Color = { id: string; name: string; variant: number | null; filename: string | null;
  hasOriginal: boolean; hasResult: boolean; pageNumber: number | null; hasPage: boolean; stale: boolean; stage: string | null };
type Batch = { productName: string; sku: string; connected: boolean; configured: boolean; configurationError: string | null;
  hasMeasurements: boolean; templateReady: boolean; pendingColorId: string | null; prompt: string; colors: Color[] };
type Result = { status?: string; sessionId?: string; previewUrl?: string; editUrl?: string; message?: string };
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
    const controller = new AbortController();
    queueMicrotask(() => {
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
      setMessage('Todas as páginas disponíveis foram preparadas no mesmo design. Abra o Canva e trabalhe cada página com suas referências de formato em cima e cor embaixo.');
    });
  }

  function editAll() {
    void run('Abrindo o design…', async signal => {
      if (batch?.prompt && navigator.clipboard) await navigator.clipboard.writeText(batch.prompt).catch(() => {});
      const result = await post('/api/admin/catalog/canva/batch', 'edit', undefined, undefined, signal);
      if (!result.editUrl) throw new Error('Não foi possível abrir o design.');
      window.location.assign(result.editUrl);
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
      {!batch.connected && batch.configured && <p>Conecte sua conta Canva na <Link href={`${productUrl}/canva/${batch.colors[0]?.id || ''}`}>página de uma cor</Link> para começar.</p>}
      {!batch.hasMeasurements && <p>Cadastre a referência de formato e proporções do modelo antes de preparar o lote.</p>}
      {!batch.templateReady && <p>Cadastre a imagem modelo transparente na página de uma cor antes de preparar o lote.</p>}
      <p>O portal prepara as cores em sequência no mesmo design. Cada página recebe o modelo grande, a referência de formato ampliada em cima e a foto real da cor ampliada embaixo. No primeiro resultado, mantenha as duas referências para permitir refinamento; remova-as somente antes de importar. A geração por IA continua sendo iniciada no Pede pro Canva.</p>
      <details open><summary>Comando para copiar — todas as cores</summary>
        <textarea aria-label="Comando do lote para o Canva" readOnly value={batch.prompt} rows={18} style={{ width: '100%' }} />
        <button type="button" className="button secondary small" disabled={!batch.prompt} onClick={async () => {
          try { await navigator.clipboard.writeText(batch.prompt); setMessage('Comando copiado.'); }
          catch { setMessage('Selecione o texto e copie o comando.'); }
        }}>Copiar comando</button>
      </details>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button type="button" className="button" disabled={!!busy || !canPrepare} onClick={prepareAll}>Preparar todas as cores</button>
        <button type="button" className="button secondary" disabled={!!busy || !allReady} onClick={editAll}>Abrir design no Canva</button>
        <button type="button" className="button secondary" disabled={!!busy || !batch.colors.some(color => color.hasPage && !color.stale)} onClick={importAll}>Importar todas as páginas prontas</button>
      </div>
      {busy && <p role="status">{busy}</p>}
      <div style={{ display: 'grid', gap: 12 }}>
        {batch.colors.map(color => <div key={color.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <strong>{color.variant ? `C${color.variant} — ` : ''}{color.name}</strong>
            <Link href={`${productUrl}/canva/${color.id}`}>Abrir esta cor</Link>
          </div>
          <p style={{ margin: '6px 0' }}>{color.filename || 'Informe o SKU, número da cor e Frente Total'}
            {' · '}{progress[color.id] || (color.stale ? 'Referências mudaram: refaça nesta cor' : color.hasPage ? `Página ${color.pageNumber || 'vinculada'}` : color.hasOriginal ? 'Aguardando preparação' : 'Cadastre a foto da cor')}
          </p>
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
