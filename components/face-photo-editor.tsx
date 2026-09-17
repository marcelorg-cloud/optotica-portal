'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProcessingFeedback } from '@/components/processing-feedback';

export function FacePhotoEditor({ endpoint, initialPhotoUrl }: { endpoint: string; initialPhotoUrl: string | null }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraDialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraRequest = useRef(0);
  const titleId = useId();
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturing, setCapturing] = useState(false);

  useEffect(() => () => {
    cameraRequest.current += 1;
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  function stopCamera() {
    cameraRequest.current += 1;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCameraReady(false);
    setCapturing(false);
  }

  function closeCamera() {
    stopCamera();
    cameraDialog.current?.close();
  }

  async function openCamera() {
    if (busy !== 'idle' || cameraDialog.current?.open) return;
    stopCamera();
    const request = cameraRequest.current;
    setCameraError('');
    cameraDialog.current?.showModal();
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Este navegador não disponibilizou a câmera. Abra o portal por HTTPS em um navegador compatível ou use “Escolher foto”.');
      }
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (request !== cameraRequest.current || !video.current) {
        media.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = media;
      video.current.srcObject = media;
      await video.current.play();
    } catch (error) {
      if (request !== cameraRequest.current) return;
      stopCamera();
      const name = error instanceof Error ? error.name : '';
      setCameraError(name === 'NotAllowedError'
        ? 'Permita o acesso à câmera nas configurações deste site no navegador e tente novamente.'
        : name === 'NotFoundError'
          ? 'Nenhuma câmera encontrada. Conecte uma câmera ou use “Escolher foto”.'
          : name === 'NotReadableError'
            ? 'A câmera está indisponível. Feche outros aplicativos que estejam usando a câmera e tente novamente.'
            : error instanceof Error && name === 'Error' ? error.message : 'Não foi possível abrir a câmera. Verifique as permissões e tente novamente.');
    }
  }

  function capturePhoto() {
    const source = video.current;
    if (!source || !cameraReady || capturing || !source.videoWidth || !source.videoHeight) return;
    setCapturing(true);
    const request = cameraRequest.current;
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) { setCapturing(false); setCameraError('Não foi possível capturar a foto. Tente novamente.'); return; }
    context.drawImage(source, 0, 0);
    canvas.toBlob(blob => {
      if (request !== cameraRequest.current) return;
      if (!blob) { setCapturing(false); setCameraError('Não foi possível capturar a foto. Tente novamente.'); return; }
      closeCamera();
      void upload(new File([blob], 'foto-prova-online.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.95);
  }
  const [photo, setPhoto] = useState(initialPhotoUrl);
  const [pending, setPending] = useState<{url:string;token:string}|null>(null);
  const [busy,setBusy] = useState<'idle'|'processing'|'confirming'>('idle');
  const [message,setMessage] = useState('');
  useProcessingFeedback(busy !== 'idle',busy === 'confirming' ? 'Confirmando foto…' : 'Processando foto com IA…');
  async function upload(file?: File) {
    if (!file || busy !== 'idle') return;
    setBusy('processing'); setMessage(''); setPending(null);
    try {
      const form = new FormData(); form.append('photo',file);
      const response = await fetch(endpoint,{method:'POST',body:form});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Não foi possível processar a foto.');
      setPending({url:data.processedUrl,token:data.token}); setMessage(data.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha de conexão. Tente novamente.'); }
    finally { setBusy('idle'); if(fileInput.current) fileInput.current.value=''; }
  }
  async function confirm() {
    if (!pending || busy !== 'idle') return;
    setBusy('confirming'); setMessage('');
    try {
      const response = await fetch(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:pending.token})});
      const data = await response.json();
      if (!response.ok) { if(response.status===409) { setPending(null); router.refresh(); } throw new Error(data.message); }
      setPhoto(data.photoUrl); setPending(null); setMessage(data.message); router.refresh();
    } catch(error) { setMessage(error instanceof Error ? error.message : 'Falha de conexão. Confira a foto atual antes de tentar novamente.'); }
    finally { setBusy('idle'); }
  }
  return <>
    <dialog ref={cameraDialog} aria-labelledby={titleId} onCancel={closeCamera} onClose={stopCamera}
      style={{ width: 'min(640px, calc(100vw - 32px))', maxHeight: '90dvh', overflow: 'auto', border: '1px solid #dce4ec', borderRadius: 24, padding: 24, color: '#182d42', background: '#fff', boxShadow: '0 24px 80px #182d4240' }}>
      <h2 id={titleId}>Foto para Prova Online</h2>
      <p className="helper">Olhe de frente para a câmera e mantenha o rosto inteiro visível, em um ambiente iluminado.</p>
      <video ref={video} autoPlay playsInline muted aria-label="Prévia da câmera"
        onLoadedData={() => { if (stream.current) setCameraReady(true); }}
        style={{ display: 'block', width: '100%', maxHeight: '55dvh', background: '#182d42', borderRadius: 16, objectFit: 'contain' }} />
      <p role="status" className="helper">{cameraError || (cameraReady ? 'Confira o enquadramento antes de capturar.' : 'Abrindo câmera… Autorize o acesso no navegador.')}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="button primary" disabled={!cameraReady || capturing} onClick={capturePhoto}>{capturing ? 'Capturando…' : 'Capturar foto'}</button>
        <button type="button" className="button secondary" onClick={closeCamera}>Cancelar</button>
      </div>
    </dialog>
    <div className="patient-photo-column"><p className="patient-photo-label">{pending ? 'Prévia processada — confira antes de usar' : 'Foto para Prova Online'}</p>
      <div className="face-photo-preview patient-photo-frame">{pending?.url || photo ? <img src={pending?.url || photo || ''} alt={pending ? 'Prévia da nova foto processada' : 'Foto ativa para prova online'} /> : <span>Envie uma foto frontal</span>}</div>
      {pending && photo && <p className="helper">A foto anterior continua ativa nos dois painéis.</p>}
    </div>
    <div className="patient-photo-controls"><p className="helper">A IA prepara o fundo e a iluminação. Confira se o resultado preserva seu rosto antes de confirmar.</p>
      <div className="patient-photo-actions">
        <button type="button" className="button secondary" disabled={busy !== 'idle'} onClick={()=>fileInput.current?.click()}>Escolher foto</button>
        <button type="button" className="button secondary" disabled={busy !== 'idle'} onClick={openCamera}>Tirar foto</button>
        {pending && <><button type="button" className="button primary" disabled={busy !== 'idle'} onClick={confirm}>Usar esta foto</button><button type="button" className="button secondary" disabled={busy !== 'idle'} onClick={()=>{setPending(null);setMessage('Foto anterior mantida.');}}>Descartar prévia</button></>}
        <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy !== 'idle'} onChange={e=>upload(e.target.files?.[0])}/>

      </div>
      <p role="status">{busy === 'processing' ? 'Processando com IA…' : busy === 'confirming' ? 'Confirmando foto…' : pending ? 'Aguardando sua confirmação' : photo ? 'Foto ativa' : ''}</p>
      {message && <p role="status" className="helper">{message}</p>}
    </div>
  </>;
}
