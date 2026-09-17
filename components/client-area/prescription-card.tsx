'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PrescriptionPreview } from '@/components/prescription-preview';
import { formatSignedSphere, formatDiopter, formatAxis } from '@/lib/prescription-format';

type Eye = { esferico: string; cilindrico: string; eixo: string; adicao: string } | null;

export function PrescriptionCard({ issuedId, od, oe, observations }: {
  issuedId: string | null; clientName: string;
  od: Eye; oe: Eye; professionalName: string; professionalRegistration: string; observations?: string | null;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!od || !oe) return <p className="notice">Sua receita ainda não está disponível.</p>;
  return <>
    {previewOpen && issuedId && <PrescriptionPreview url={`/prescricao/${issuedId}`} onClose={() => setPreviewOpen(false)} />}
    <div className="rx-actions">{issuedId
      ? <Link className="button primary" href={`/prescricao/${issuedId}`} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setPreviewOpen(true); } }}>Visualizar / salvar prescrição com QR Code</Link>
      : <p className="notice">Receita registrada. O documento com QR Code ficará disponível após a emissão pelo profissional.</p>}
    </div>
    <div className="rx-scroll"><table className="rx-table rx-table-compact"><thead><tr><th></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead><tbody>
      <tr><th>OD</th><td>{formatSignedSphere(od.esferico) || '—'}</td><td>{formatDiopter(od.cilindrico) || '—'}</td><td>{formatAxis(od.eixo) || '—'}</td><td>{formatSignedSphere(od.adicao) || '—'}</td></tr>
      <tr><th>OE</th><td>{formatSignedSphere(oe.esferico) || '—'}</td><td>{formatDiopter(oe.cilindrico) || '—'}</td><td>{formatAxis(oe.eixo) || '—'}</td><td>{formatSignedSphere(oe.adicao) || '—'}</td></tr>
    </tbody></table></div>
    {observations?.trim() && <div className="prescription-notes-readonly"><strong>Orientações do profissional</strong><p>{observations}</p></div>}
  </>;
}
