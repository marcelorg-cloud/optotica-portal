'use client';

import { useEffect, useRef, useState } from 'react';
import { orderCode } from '@/lib/order-code';

type Eye = { esferico: string; cilindrico: string; eixo: string; adicao: string } | null;

export function PrescriptionCard({ orderNumber, clientName, whatsapp, dnp, od, oe, professionalName, professionalRegistration }: {
  orderNumber: number; clientName: string; whatsapp: string; dnp: string;
  od: Eye; oe: Eye; professionalName: string; professionalRegistration: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);
  const val = (v?: string) => v?.trim() ? v : '—';
  if (!od || !oe || ![od.esferico, od.cilindrico, oe.esferico, oe.cilindrico].some((value) => value.trim())) {
    return <p className="notice">Sua receita ainda não está disponível. Ela aparecerá aqui após ser registrada pelo profissional.</p>;
  }

  return (
    <>
      <div className="rx-actions">
        <button className="button primary" type="button" onClick={() => setOpen(true)}>Visualizar / salvar receita em PDF</button>
      </div>
      <div className="rx-scroll">
        <table className="rx-table">
          <thead><tr><th></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead>
          <tbody>
            <tr><th>OD</th><td>{val(od?.esferico)}</td><td>{val(od?.cilindrico)}</td><td>{val(od?.eixo)}</td><td>{val(od?.adicao)}</td></tr>
            <tr><th>OE</th><td>{val(oe?.esferico)}</td><td>{val(oe?.cilindrico)}</td><td>{val(oe?.eixo)}</td><td>{val(oe?.adicao)}</td></tr>
          </tbody>
        </table>
      </div>

      <dialog
        ref={dialogRef}
        className="patient-rx-dialog"
        id="rxModal"
        aria-labelledby="patient-rx-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(event) => { if ((event.target as HTMLElement).id === 'rxModal') setOpen(false); }}
      >
        <div className="rx-doc">
          <div className="rx-doc-head">
            <div><p className="eyebrow">Receituário óptico</p><h2 id="patient-rx-title">Prescrição de óculos</h2></div>
            <strong>Pedido {orderCode(clientName, orderNumber)}</strong>
          </div>
          <div className="rx-doc-body">
            <div className="summary-grid patient-rx-summary">
              <div className="stat"><span>Paciente</span><strong>{clientName}</strong></div>
              <div className="stat"><span>WhatsApp</span><strong>{whatsapp}</strong></div>
              <div className="stat"><span>DNP</span><strong>{dnp}</strong></div>
            </div>
            <div style={{ height: 20 }} />
            <div className="rx-scroll">
              <table className="rx-table">
                <thead><tr><th></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead>
                <tbody>
                  <tr><th>OD</th><td>{val(od?.esferico)}</td><td>{val(od?.cilindrico)}</td><td>{val(od?.eixo)}</td><td>{val(od?.adicao)}</td></tr>
                  <tr><th>OE</th><td>{val(oe?.esferico)}</td><td>{val(oe?.cilindrico)}</td><td>{val(oe?.eixo)}</td><td>{val(oe?.adicao)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="sig-grid">
              <div className="sig"><strong>{professionalName}</strong><br />{professionalRegistration}</div>
              <div className="sig"><strong>Documento gerado eletronicamente</strong><br />Portal Optótica — sem assinatura física</div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="button secondary" type="button" onClick={() => setOpen(false)}>Fechar</button>
            <button className="button primary" type="button" onClick={() => window.print()}>Imprimir / salvar PDF</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
