'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { calculateDnp, type DnpPoints, type Point } from '@/lib/dnp';
import { detectCardEdges, detectFacePoints } from '@/lib/dnp-vision';

// Resolução interna de trabalho: tanto a foto da câmera quanto a enviada por
// upload são reamostradas para esta largura antes de qualquer detecção,
// desenho ou cálculo. Mantém performance previsível (fotos de celular podem
// vir com 4000px+ de largura) sem perder precisão — o cálculo é uma razão
// entre distâncias na mesma foto, então a escala usada não importa contanto
// que seja a mesma pro cartão e pra distância pupilar.
const WORK_WIDTH = 960;
const MARKER_RADIUS = 9;
const HIT_RADIUS = 22; // maior que o marcador — mais fácil de "pegar" no toque

type MarkerKey = keyof DnpPoints;

const MARKER_COLOR: Record<MarkerKey, string> = {
  pupilA: '#22d3ee',
  pupilB: '#22d3ee',
  nasalCenter: '#4ade80',
  cardLeft: '#f87171',
  cardRight: '#f87171'
};

const MARKER_SHAPE: Record<MarkerKey, 'dot' | 'cross'> = {
  pupilA: 'dot',
  pupilB: 'dot',
  nasalCenter: 'dot',
  cardLeft: 'cross',
  cardRight: 'cross'
};

function defaultPoints(width: number, height: number): DnpPoints {
  return {
    pupilA: { x: width * 0.42, y: height * 0.44 },
    pupilB: { x: width * 0.58, y: height * 0.44 },
    nasalCenter: { x: width * 0.5, y: height * 0.46 },
    cardLeft: { x: width * 0.3, y: height * 0.74 },
    cardRight: { x: width * 0.7, y: height * 0.74 }
  };
}

function resample(source: CanvasImageSource, naturalWidth: number, naturalHeight: number): HTMLCanvasElement {
  const scale = WORK_WIDTH / naturalWidth;
  const canvas = document.createElement('canvas');
  canvas.width = WORK_WIDTH;
  canvas.height = Math.round(naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function drawOverlay(ctx: CanvasRenderingContext2D, pts: DnpPoints) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pts.pupilA.x, pts.pupilA.y);
  ctx.lineTo(pts.nasalCenter.x, pts.nasalCenter.y);
  ctx.lineTo(pts.pupilB.x, pts.pupilB.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.setLineDash([6, 4]);
  ctx.moveTo(pts.cardLeft.x, pts.cardLeft.y);
  ctx.lineTo(pts.cardRight.x, pts.cardRight.y);
  ctx.stroke();
  ctx.setLineDash([]);

  (Object.keys(pts) as MarkerKey[]).forEach((key) => {
    const p = pts[key];
    const color = MARKER_COLOR[key];
    if (MARKER_SHAPE[key] === 'dot') {
      ctx.fillStyle = color;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, MARKER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x - MARKER_RADIUS, p.y);
      ctx.lineTo(p.x + MARKER_RADIUS, p.y);
      ctx.moveTo(p.x, p.y - MARKER_RADIUS);
      ctx.lineTo(p.x, p.y + MARKER_RADIUS);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#111';
      ctx.stroke();
    }
  });
  ctx.restore();
}

export function DnpPhotoTool({ orderId, onSaved, onClose }: {
  orderId: string;
  onSaved: (odMm: number, oeMm: number, photoUrl: string | null) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const draggingRef = useRef<MarkerKey | null>(null);

  const [phase, setPhase] = useState<'source' | 'camera' | 'measure'>('source');
  const [cameraError, setCameraError] = useState('');
  const [points, setPoints] = useState<DnpPoints | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionNotice, setDetectionNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Libera a câmera se a ferramenta for desmontada com a câmera ainda ativa
  // (ex.: usuário fecha o modal sem clicar em "Cancelar"/"Salvar").
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const result = useMemo(() => (points ? calculateDnp(points) : null), [points]);

  // Redesenha o canvas (foto base + marcadores) sempre que um ponto muda —
  // efeito puramente imperativo sobre o DOM, não deriva estado do React.
  useEffect(() => {
    const canvas = canvasRef.current;
    const source = imageRef.current;
    if (!canvas || !source || !points) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(source, 0, 0);
      drawOverlay(ctx, points);
    }
  }, [points]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    setCameraError('');
    setPhase('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError('Não foi possível acessar a câmera. Verifique a permissão do navegador ou envie uma foto.');
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = resample(video, video.videoWidth, video.videoHeight);
    stopCamera();
    loadWorkingImage(canvas);
  }

  function onFileChosen(file: File) {
    const img = new Image();
    img.onload = () => loadWorkingImage(resample(img, img.naturalWidth, img.naturalHeight));
    img.src = URL.createObjectURL(file);
  }

  async function loadWorkingImage(source: HTMLCanvasElement) {
    imageRef.current = source;
    setPhase('measure');
    setPoints(defaultPoints(source.width, source.height));
    setDetecting(true);
    setDetectionNotice('');
    try {
      const [face, card] = await Promise.all([
        detectFacePoints(source).catch(() => null),
        detectCardEdges(source).catch(() => null)
      ]);
      if (!face && !card) {
        setDetectionNotice('Não foi possível detectar os pontos automaticamente. Ajuste manualmente sobre a foto.');
      } else if (!face) {
        setDetectionNotice('Pupilas não detectadas automaticamente — ajuste os pontos ciano/verde.');
      } else if (!card) {
        setDetectionNotice('Cartão não detectado automaticamente — ajuste os pontos vermelhos sobre as bordas dele.');
      } else {
        setDetectionNotice('Pontos detectados automaticamente — confira e ajuste se necessário antes de salvar.');
      }
      setPoints((prev) => ({
        pupilA: face?.pupilA ?? prev!.pupilA,
        pupilB: face?.pupilB ?? prev!.pupilB,
        nasalCenter: face?.nasalCenter ?? prev!.nasalCenter,
        cardLeft: card?.cardLeft ?? prev!.cardLeft,
        cardRight: card?.cardRight ?? prev!.cardRight
      }));
    } finally {
      setDetecting(false);
    }
  }

  function canvasPointFromEvent(e: { clientX: number; clientY: number }): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function nearestMarker(p: Point): MarkerKey | null {
    if (!points) return null;
    let best: MarkerKey | null = null;
    let bestDist = HIT_RADIUS;
    (Object.keys(points) as MarkerKey[]).forEach((key) => {
      const d = Math.hypot(points[key].x - p.x, points[key].y - p.y);
      if (d <= bestDist) { bestDist = d; best = key; }
    });
    return best;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (detecting) return;
    const p = canvasPointFromEvent(e);
    const key = nearestMarker(p);
    if (key) {
      draggingRef.current = key;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const key = draggingRef.current;
    if (!key || !points) return;
    const p = canvasPointFromEvent(e);
    const canvas = canvasRef.current!;
    const clamped = {
      x: Math.min(Math.max(p.x, 0), canvas.width),
      y: Math.min(Math.max(p.y, 0), canvas.height)
    };
    setPoints({ ...points, [key]: clamped });
  }

  function onPointerUp() {
    draggingRef.current = null;
  }

  function retake() {
    stopCamera();
    imageRef.current = null;
    setPoints(null);
    setDetectionNotice('');
    setSaveError('');
    setPhase('source');
  }

  async function save() {
    if (!result || !imageRef.current || !points) return;
    setSaving(true);
    setSaveError('');
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = imageRef.current.width;
    exportCanvas.height = imageRef.current.height;
    const ctx = exportCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(imageRef.current, 0, 0);
      drawOverlay(ctx, points); // grava a foto já com os pontos marcados, para auditoria posterior
    }
    const blob: Blob | null = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      setSaving(false);
      setSaveError('Não foi possível gerar a foto.');
      return;
    }

    const form = new FormData();
    form.append('photo', blob, 'dnp.jpg');
    form.append('odMm', String(result.odMm));
    form.append('oeMm', String(result.oeMm));
    const response = await fetch(`/api/professional/orders/${orderId}/client/dnp-photo`, { method: 'POST', body: form });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (response.ok) {
      onSaved(result.odMm, result.oeMm, payload.photoUrl || null);
    } else {
      setSaveError(payload.message || 'Não foi possível salvar a medição.');
    }
  }

  return (
    <div className="modal active" role="dialog" aria-modal="true">
      <div className="dnp-tool">
        <div className="dnp-tool-head">
          <h3>Medir DNP com foto</h3>
          <button className="button secondary" type="button" onClick={() => { stopCamera(); onClose(); }}>Fechar</button>
        </div>

        {phase === 'source' && (
          <div className="stack">
            <p className="helper">
              Peça ao paciente para segurar um cartão de crédito encostado na testa ou logo abaixo do nariz,
              olhando de frente para a câmera. Tire a foto agora ou envie uma já tirada.
            </p>
            <div className="actions">
              <button className="button primary" type="button" onClick={openCamera}>Usar câmera</button>
              <label className="button secondary" htmlFor="dnpPhotoInput">Enviar foto</label>
              <input
                id="dnpPhotoInput"
                className="upload"
                type="file"
                accept="image/*"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChosen(f); e.target.value = ''; }}
              />
            </div>
          </div>
        )}

        {phase === 'camera' && (
          <div className="stack">
            {cameraError ? (
              <>
                <p className="form-message error">{cameraError}</p>
                <div className="actions">
                  <button className="button secondary" type="button" onClick={retake}>Voltar</button>
                </div>
              </>
            ) : (
              <>
                <video ref={videoRef} className="dnp-video" playsInline muted />
                <div className="actions">
                  <button className="button primary" type="button" onClick={capturePhoto}>Capturar foto</button>
                  <button className="button secondary" type="button" onClick={retake}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        )}

        {phase === 'measure' && (
          <div className="stack">
            {detecting && <p className="helper">Detectando pupilas e cartão automaticamente…</p>}
            {!detecting && detectionNotice && <p className="notice">{detectionNotice}</p>}
            <canvas
              ref={canvasRef}
              className="dnp-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <p className="helper">
              Arraste os pontos para ajustar: ciano/verde nas pupilas e na referência nasal, vermelho nas bordas do cartão.
            </p>
            <div className="summary-grid" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
              <div className="stat"><span>DNP OD</span><strong>{result ? `${result.odMm} mm` : '—'}</strong></div>
              <div className="stat"><span>DNP OE</span><strong>{result ? `${result.oeMm} mm` : '—'}</strong></div>
              <div className="stat"><span>Total</span><strong>{result ? `${result.totalMm} mm` : '—'}</strong></div>
            </div>
            <div className="actions">
              <button className="button primary" type="button" disabled={!result || saving} onClick={save}>
                {saving ? 'Salvando…' : 'Salvar medição'}
              </button>
              <button className="button secondary" type="button" onClick={retake} disabled={saving}>Tirar outra foto</button>
            </div>
            {!result && <p className="form-message error">Ajuste os pontos do cartão — eles não podem estar no mesmo lugar.</p>}
            {saveError && <p className="form-message error">{saveError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
