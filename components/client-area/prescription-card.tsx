'use client';

import Link from 'next/link';

type Eye = { esferico: string; cilindrico: string; eixo: string; adicao: string } | null;

export function PrescriptionCard({ issuedId, od, oe }: {
  issuedId: string | null; clientName: string;
  od: Eye; oe: Eye; professionalName: string; professionalRegistration: string;
}) {
  const val = (v?: string) => v?.trim() ? v : '—';
  if (!od || !oe) return <p className="notice">Sua receita ainda não está disponível.</p>;
  return <>
    <div className="rx-actions">{issuedId
      ? <Link className="button primary" href={`/prescricao/${issuedId}`}>Visualizar / salvar prescrição com QR Code</Link>
      : <p className="notice">Receita registrada. O documento com QR Code ficará disponível após a emissão pelo profissional.</p>}
    </div>
    <div className="rx-scroll"><table className="rx-table"><thead><tr><th></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead><tbody>
      <tr><th>OD</th><td>{val(od.esferico)}</td><td>{val(od.cilindrico)}</td><td>{val(od.eixo)}</td><td>{val(od.adicao)}</td></tr>
      <tr><th>OE</th><td>{val(oe.esferico)}</td><td>{val(oe.cilindrico)}</td><td>{val(oe.eixo)}</td><td>{val(oe.adicao)}</td></tr>
    </tbody></table></div>
  </>;
}
