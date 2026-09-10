'use client';

import { useState } from 'react';
import { orderCode } from '@/lib/order-code';

type Eye = { esferico: string; cilindrico: string; eixo: string; adicao: string } | null;

export function PrescriptionCard({ orderNumber, clientName, whatsapp, dnp, od, oe, professionalName, professionalRegistration }: {
  orderNumber: number; clientName: string; whatsapp: string; dnp: string;
  od: Eye; oe: Eye; professionalName: string; professionalRegistration: string;
}) {
  const [open, setOpen] = useState(false);
  const val = (v?: string) => (v && v !== '0' ? v : '—');

  return (
    <>
      <div className="rx-actions">
        <button className="button primary" type="button" onClick={() => setOpen(true)}>Gerar PDF da prescrição</button>
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

      <div
        className={`modal${open ? ' active' : ''}`}
        id="rxModal"
        onClick={(event) => { if ((event.target as HTMLElement).id === 'rxModal') setOpen(false); }}
      >
        <div className="rx-doc">
          <div className="rx-doc-head">
            <div><p className="eyebrow">Receituário óptico</p><h2>Prescrição de óculos</h2></div>
            <strong>Pedido {orderCode(clientName, orderNumber)}</strong>
          </div>
          <div className="rx-doc-body">
            <div className="summary-grid" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
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
      </div>
    </>
  );
}
