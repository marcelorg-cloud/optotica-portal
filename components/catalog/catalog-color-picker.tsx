'use client';

import { useState } from 'react';
import { COLOR_VOCABULARY } from '@/lib/catalog/sku-standard';

type Entry = { id: string; color_number: number; color_principal: string; color_secondary: string | null; note: string | null };

export function CatalogColorPicker({ productId, colorId, currentNumber, usedNumbers, busy, onBusy, onSaved }: {
  productId: string; colorId: string; currentNumber: number | null; usedNumbers: number[];
  busy: boolean; onBusy: (busy: boolean) => void; onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const endpoint = `/api/admin/catalog/products/${productId}/images/${colorId}/color`;

  async function start() {
    setError(''); setNotice(''); onBusy(true);
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Não foi possível carregar as cores.');
      setEntries(data.colors);
      setSelected(data.colors.find((entry: Entry) => entry.color_number === currentNumber)?.id || '');
      setCreating(false); setOpen(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao carregar as cores.'); }
    finally { onBusy(false); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    onBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creating
        ? { colorPrincipal: values.get('principal'), colorSecondary: values.get('secondary'), note: values.get('note') }
        : { registryId: selected }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Não foi possível salvar a cor.');
      setOpen(false); setNotice(data.message);
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar a cor.'); }
    finally { onBusy(false); }
  }

  return <div style={{ minWidth: 0, width: '100%' }}>
    {!open && <button className="text-button" type="button" disabled={busy} onClick={start}>Trocar cor</button>}
    {open && <form onSubmit={save} style={{ display: 'grid', gap: 10, marginTop: 8, maxWidth: 440 }}>
      {!creating ? <>
        <label>Cores disponíveis<select aria-label="Cores disponíveis" value={selected} onChange={(event) => setSelected(event.target.value)} required disabled={busy}>
          <option value="" disabled>Selecione uma cor</option>
          {entries.map((entry) => <option key={entry.id} value={entry.id} disabled={usedNumbers.includes(entry.color_number) && entry.color_number !== currentNumber}>
            Cor {entry.color_number} — {entry.color_principal}{entry.color_secondary ? ` / ${entry.color_secondary}` : ''}{entry.note ? ` (${entry.note})` : ''}{usedNumbers.includes(entry.color_number) && entry.color_number !== currentNumber ? ' — já usada neste produto' : ''}
          </option>)}
        </select></label>
        <button className="button secondary small" type="button" disabled={busy} onClick={() => setCreating(true)}>+ Criar nova cor</button>
      </> : <>
        <label>Cor principal<select name="principal" required defaultValue="" disabled={busy}><option value="" disabled>Selecione</option>{COLOR_VOCABULARY.map((color) => <option key={color}>{color}</option>)}</select></label>
        <label>Cor secundária (opcional)<select name="secondary" disabled={busy}><option value="">Nenhuma</option>{COLOR_VOCABULARY.map((color) => <option key={color}>{color}</option>)}</select></label>
        <label>Variação (opcional)<input name="note" placeholder="Ex.: fosco, translúcido" maxLength={60} disabled={busy} /></label>
        <button className="text-button" type="button" disabled={busy} onClick={() => setCreating(false)}>Voltar às cores disponíveis</button>
      </>}
      <span className="helper">Altera a identificação deste cartão e mantém suas fotos.</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="button primary small" disabled={busy || (!creating && (!selected || entries.find((entry) => entry.id === selected)?.color_number === currentNumber))}>{busy ? 'Aguarde…' : creating ? 'Criar e aplicar cor' : 'Salvar cor'}</button>
        <button className="button secondary small" type="button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>Cancelar</button>
      </div>
    </form>}
    {error && <p role="alert" style={{ color: 'var(--danger, #b42318)' }}>{error}</p>}
    {notice && <p role="status" className="helper">{notice}</p>}
  </div>;
}
