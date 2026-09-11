'use client';

import { useRef, useState } from 'react';
import { computeOverlayGeometry, type Point } from '@/lib/tryon/geometry';

export type TryonProduct = {
  id: string; // catalog_product_color_images.id
  productId: string;
  modelName: string;
  colorName: string;
  lensWidthMm: number;
  processedImageUrl: string;
};

const WORK_WIDTH = 960;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load-failed'));
    img.src = url;
  });
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}

export function TryonPanel({
  clientPhotoUrl,
  dnpOd,
  dnpOe,
  products
}: {
  clientPhotoUrl: string | null;
  dnpOd: number | null;
  dnpOe: number | null;
  products: TryonProduct[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const lastAnalysis = useRef<{ pupilA: Point; pupilB: Point; photoWidth: number; photoHeight: number } | null>(null);

  const dnpTotalMm = dnpOd != null && dnpOe != null ? Number(dnpOd) + Number(dnpOe) : null;
  const canTry = Boolean(clientPhotoUrl) && dnpTotalMm != null && dnpTotalMm > 0;

  async function handleSelect(product: TryonProduct) {
    setSelectedId(product.id);
    setMessage(null);
    lastAnalysis.current = null;
    if (!canTry || !clientPhotoUrl || dnpTotalMm == null) return;

    setStatus('loading');
    try {
      const [clientImg, frameImg] = await Promise.all([loadImage(clientPhotoUrl), loadImage(product.processedImageUrl)]);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = WORK_WIDTH / clientImg.naturalWidth;
      canvas.width = WORK_WIDTH;
      canvas.height = Math.round(clientImg.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(clientImg, 0, 0, canvas.width, canvas.height);

      // Roda no navegador — mesmo código usado por "Medir DNP com foto"
      // (lib/dnp-vision.ts), reaproveitado aqui sem nenhuma detecção nova
      // (ver seção 0.29 do estado consolidado do projeto).
      const { detectFacePoints } = await import('@/lib/dnp-vision');
      const points = await detectFacePoints(canvas);
      if (!points) {
        setStatus('error');
        setMessage({ kind: 'error', text: 'Não conseguimos identificar seu rosto nesta foto. Tente enviar uma foto olhando de frente para a câmera, com boa iluminação.' });
        return;
      }

      const frameAspectRatio = frameImg.naturalHeight / frameImg.naturalWidth;
      const geometry = computeOverlayGeometry({
        pupilA: points.pupilA,
        pupilB: points.pupilB,
        dnpTotalMm,
        frameWidthMm: product.lensWidthMm,
        frameAspectRatio
      });
      if (!geometry) {
        setStatus('error');
        setMessage({ kind: 'error', text: 'Não foi possível calcular o encaixe desta armação.' });
        return;
      }

      ctx.save();
      ctx.translate(geometry.centerX, geometry.centerY);
      ctx.rotate((geometry.angleDeg * Math.PI) / 180);
      ctx.drawImage(frameImg, -geometry.widthPx / 2, -geometry.heightPx / 2, geometry.widthPx, geometry.heightPx);
      ctx.restore();

      lastAnalysis.current = { pupilA: points.pupilA, pupilB: points.pupilB, photoWidth: canvas.width, photoHeight: canvas.height };
      setStatus('ready');
    } catch {
      setStatus('error');
      setMessage({ kind: 'error', text: 'Não foi possível carregar as imagens da prova. Tente novamente.' });
    }
  }

  async function handleSaveAsMain() {
    const product = products.find((p) => p.id === selectedId);
    const analysis = lastAnalysis.current;
    if (!product || !analysis) return;
    setSaving(true);
    setMessage(null);
    const { ok, payload } = await fetchJson('/api/client/tryon/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: product.productId,
        colorName: product.colorName,
        pupilA: analysis.pupilA,
        pupilB: analysis.pupilB,
        photoWidth: analysis.photoWidth,
        photoHeight: analysis.photoHeight
      })
    });
    setSaving(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message || (ok ? 'Salvo.' : 'Não foi possível salvar.') });
  }

  if (!products.length) {
    return <div className="catalog-empty">Nenhuma armação do catálogo online disponível para prova ainda.</div>;
  }

  if (!canTry) {
    return (
      <div className="setup-note">
        {!clientPhotoUrl && <p>Envie sua foto de prova online em &quot;Meus dados&quot; acima antes de experimentar as armações.</p>}
        {clientPhotoUrl && dnpTotalMm == null && <p>Sua DNP ainda não foi medida pelo profissional — assim que estiver registrada, a prova online libera aqui.</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="catalog-color-grid" style={{ marginBottom: 16 }}>
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            className={`card catalog-product-card${selectedId === product.id ? ' selected' : ''}`}
            style={{ textAlign: 'left', cursor: 'pointer', borderColor: selectedId === product.id ? 'var(--accent)' : undefined }}
            onClick={() => handleSelect(product)}
          >
            <img src={product.processedImageUrl} alt={`${product.modelName} · ${product.colorName}`} style={{ width: '100%', height: 90, objectFit: 'contain' }} />
            <p style={{ margin: '8px 0 0', fontSize: 13 }}><strong>{product.modelName}</strong></p>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}><span className="catalog-swatch" />{product.colorName}</p>
          </button>
        ))}
      </div>

      {selectedId && (
        <div className="card" style={{ padding: 16 }}>
          {status === 'loading' && <p className="muted">Calculando o encaixe na sua foto…</p>}
          <canvas ref={canvasRef} style={{ width: '100%', maxWidth: 480, borderRadius: 12, display: status === 'idle' ? 'none' : 'block' }} />
          {status === 'ready' && (
            <button className="button primary" type="button" disabled={saving} onClick={handleSaveAsMain} style={{ marginTop: 12 }}>
              {saving ? 'Salvando…' : 'Usar esta foto como minha imagem principal'}
            </button>
          )}
          {message && <p className={`form-message ${message.kind}`} style={{ marginTop: 12 }}>{message.text}</p>}
        </div>
      )}
    </div>
  );
}
