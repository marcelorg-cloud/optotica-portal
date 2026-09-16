'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProcessingFeedback } from '@/components/processing-feedback';

export function FacePhotoEditor({ endpoint, initialPhotoUrl }: { endpoint: string; initialPhotoUrl: string | null }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null); const camera = useRef<HTMLInputElement>(null);
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
    finally { setBusy('idle'); if(fileInput.current) fileInput.current.value=''; if(camera.current) camera.current.value=''; }
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
    <div className="patient-photo-column"><p className="patient-photo-label">{pending ? 'Prévia processada — confira antes de usar' : 'Foto para Prova Online'}</p>
      <div className="face-photo-preview patient-photo-frame">{pending?.url || photo ? <img src={pending?.url || photo || ''} alt={pending ? 'Prévia da nova foto processada' : 'Foto ativa para prova online'} /> : <span>Envie uma foto frontal</span>}</div>
      {pending && photo && <p className="helper">A foto anterior continua ativa nos dois painéis.</p>}
    </div>
    <div className="patient-photo-controls"><p className="helper">A IA prepara o fundo e a iluminação. Confira se o resultado preserva seu rosto antes de confirmar.</p>
      <div className="patient-photo-actions">
        <button type="button" className="button secondary" disabled={busy !== 'idle'} onClick={()=>fileInput.current?.click()}>Escolher foto</button>
        <button type="button" className="button secondary" disabled={busy !== 'idle'} onClick={()=>camera.current?.click()}>Tirar foto</button>
        {pending && <><button type="button" className="button primary" disabled={busy !== 'idle'} onClick={confirm}>Usar esta foto</button><button type="button" className="button secondary" disabled={busy !== 'idle'} onClick={()=>{setPending(null);setMessage('Foto anterior mantida.');}}>Descartar prévia</button></>}
        <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy !== 'idle'} onChange={e=>upload(e.target.files?.[0])}/>
        <input ref={camera} hidden type="file" accept="image/*" capture="user" disabled={busy !== 'idle'} onChange={e=>upload(e.target.files?.[0])}/>
      </div>
      <p role="status">{busy === 'processing' ? 'Processando com IA…' : busy === 'confirming' ? 'Confirmando foto…' : pending ? 'Aguardando sua confirmação' : photo ? 'Foto ativa' : ''}</p>
      {message && <p role="status" className="helper">{message}</p>}
    </div>
  </>;
}
