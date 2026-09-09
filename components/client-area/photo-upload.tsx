'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';

export function PhotoUpload({ initialPhotoUrl }: { initialPhotoUrl: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage('');
    const form = new FormData();
    form.append('photo', file);
    const response = await fetch('/api/client/photo', { method: 'POST', body: form });
    const payload = await response.json().catch(() => ({}));
    setUploading(false);
    if (response.ok) {
      setPhotoUrl(payload.photoUrl || null);
      router.refresh();
    } else {
      setMessage(payload.message || 'Não foi possível salvar a foto.');
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="photo-block">
      {photoUrl ? <img className="photo" src={photoUrl} alt="Foto de prova online" /> : <div className="photo" />}
      <div>
        <p className="eyebrow">Único dado pessoal editável aqui</p>
        <h3>Foto da prova online</h3>
        <p className="helper">Você pode trocar esta foto. Os demais dados vêm do atendimento e não são editáveis nesta área.</p>
        <div style={{ height: 10 }} />
        <label className="button primary" htmlFor="photoInput">{uploading ? 'Enviando…' : 'Trocar foto'}</label>
        <input ref={inputRef} id="photoInput" className="upload" type="file" accept="image/*" onChange={onChange} disabled={uploading} />
        {message && <p className="form-message error">{message}</p>}
      </div>
    </div>
  );
}
