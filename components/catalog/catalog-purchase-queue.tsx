'use client';

import { useEffect, useState } from 'react';

type PurchaseOrder = {
  id: string; clientName: string | null; clientCpf: string | null; productName: string | null; productSku: string | null;
  colorName: string; supplierName: string | null; laboratoryName: string | null; laboratoryCity: string | null; laboratoryState: string | null;
  status: string; aliexpressOrderNumber: string | null; amountPaid: number | null; createdAt: string;
};

type MasterAddress = {
  contact_name: string; address_line: string; address_number: string | null; address_complement: string | null;
  district: string | null; city: string; state: string; postal_code: string; phone_e164: string;
} | null;

const STATUS_LABEL: Record<string, string> = {
  aguardando_compra: 'Aguardando compra', comprado: 'Comprado · aguardando envio', a_caminho: 'A caminho', entregue: 'Entregue', cancelado: 'Cancelado'
};

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}

export function CatalogPurchaseQueue() {
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [address, setAddress] = useState<MasterAddress>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  function applyLoad([ordersRes, addressRes]: Awaited<ReturnType<typeof loadPair>>) {
    if (ordersRes.ok) setOrders(ordersRes.payload.purchaseOrders);
    if (addressRes.ok) setAddress(addressRes.payload.address);
  }

  function loadPair() {
    return Promise.all([
      fetchJson('/api/admin/catalog/purchase-orders'),
      fetchJson('/api/admin/catalog/master-address')
    ]);
  }

  function load() {
    return loadPair().then(applyLoad);
  }

  useEffect(() => {
    loadPair().then(applyLoad);
  }, []);

  async function handleMarkPurchased(id: string) {
    const aliexpressOrderNumber = window.prompt('Número do pedido no AliExpress:') || '';
    if (!aliexpressOrderNumber) return;
    const amountPaidRaw = window.prompt('Valor pago (R$):') || '';
    const amountPaid = Number(amountPaidRaw.replace(',', '.'));
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) { setMessage({ kind: 'error', text: 'Valor inválido.' }); return; }
    setBusy(true);
    setMessage(null);
    const { ok, payload } = await fetchJson(`/api/admin/catalog/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'comprado', aliexpressOrderNumber, amountPaid })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) load();
  }

  async function handleAdvance(id: string, status: 'a_caminho' | 'entregue' | 'cancelado') {
    setBusy(true);
    setMessage(null);
    const { ok, payload } = await fetchJson(`/api/admin/catalog/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) load();
  }

  async function handleSaveAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const { ok, payload } = await fetchJson('/api/admin/catalog/master-address', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactName: form.get('contactName'), addressLine: form.get('addressLine'), addressNumber: form.get('addressNumber'),
        addressComplement: form.get('addressComplement'), district: form.get('district'), city: form.get('city'),
        state: form.get('state'), postalCode: form.get('postalCode'), phoneE164: form.get('phoneE164')
      })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) { setEditingAddress(false); load(); }
  }

  if (orders === null) return <p className="muted">Carregando…</p>;

  return (
    <div>
      <div className="dashboard-head">
        <div>
          <h1 style={{ fontSize: 28 }}>Fila de Compras — Pedidos de Pacientes</h1>
          <p className="muted">Nome e CPF na compra são do paciente; a entrega segue o laboratório vinculado ao atendimento, ou o endereço do master abaixo.</p>
        </div>
      </div>

      {message && <p className={`form-message ${message.kind}`}>{message.text}</p>}

      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <div className="row-flex" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: 13 }}>Endereço do master <span className="muted" style={{ fontWeight: 400 }}>(fallback, sem laboratório vinculado)</span></strong>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              {address ? `${address.contact_name} · ${address.address_line}, ${address.address_number || 's/n'} · ${address.city}/${address.state} · ${address.postal_code}` : 'Ainda não cadastrado.'}
            </p>
          </div>
          <button className="text-button" type="button" onClick={() => setEditingAddress((v) => !v)}>{address ? 'Editar endereço' : 'Cadastrar endereço'}</button>
        </div>
        {editingAddress && (
          <form className="form-grid" style={{ marginTop: 14 }} onSubmit={handleSaveAddress}>
            <label>Nome de contato<input name="contactName" defaultValue={address?.contact_name} required /></label>
            <label>Telefone<input name="phoneE164" defaultValue={address?.phone_e164} required placeholder="+55..." /></label>
            <label className="span-2">Endereço<input name="addressLine" defaultValue={address?.address_line} required /></label>
            <label>Número<input name="addressNumber" defaultValue={address?.address_number ?? ''} /></label>
            <label>Complemento<input name="addressComplement" defaultValue={address?.address_complement ?? ''} /></label>
            <label>Bairro<input name="district" defaultValue={address?.district ?? ''} /></label>
            <label>Cidade<input name="city" defaultValue={address?.city} required /></label>
            <label>Estado (UF)<input name="state" maxLength={2} defaultValue={address?.state} required /></label>
            <label>CEP<input name="postalCode" defaultValue={address?.postal_code} required /></label>
            <button className="button primary" type="submit" disabled={busy} style={{ gridColumn: '1/-1', justifySelf: 'start' }}>Salvar endereço</button>
          </form>
        )}
      </div>

      {orders.length ? (
        <section className="card table-card" style={{ overflowX: 'auto' }}>
          <div className="table-head" style={{ gridTemplateColumns: '160px 200px 150px 160px 150px 1fr' }}>
            <span>Paciente</span><span>Produto · Cor</span><span>Fornecedor</span><span>Entrega</span><span>Status</span><span>Ação</span>
          </div>
          {orders.map((order) => (
            <div className="table-row" key={order.id} style={{ gridTemplateColumns: '160px 200px 150px 160px 150px 1fr' }}>
              <span>{order.clientName || '—'}{order.clientCpf ? <><br /><span className="muted" style={{ fontSize: 11 }}>CPF {order.clientCpf}</span></> : null}</span>
              <span>{order.productName || '—'} · {order.colorName}</span>
              <span>{order.supplierName || '—'}</span>
              <span>{order.laboratoryName ? `${order.laboratoryName} · ${order.laboratoryCity}/${order.laboratoryState}` : 'Endereço do master'}</span>
              <span className="pill">{STATUS_LABEL[order.status] || order.status}</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {order.status === 'aguardando_compra' && (
                  <button className="button primary small" type="button" disabled={busy} onClick={() => handleMarkPurchased(order.id)}>Marcar comprado</button>
                )}
                {order.status === 'comprado' && (
                  <button className="button secondary small" type="button" disabled={busy} onClick={() => handleAdvance(order.id, 'a_caminho')}>Marcar a caminho</button>
                )}
                {order.status === 'a_caminho' && (
                  <button className="button secondary small" type="button" disabled={busy} onClick={() => handleAdvance(order.id, 'entregue')}>Marcar entregue</button>
                )}
                {['aguardando_compra', 'comprado'].includes(order.status) && (
                  <button className="text-button danger" type="button" disabled={busy} onClick={() => handleAdvance(order.id, 'cancelado')}>Cancelar</button>
                )}
              </span>
            </div>
          ))}
        </section>
      ) : (
        <div className="catalog-empty">Nenhum pedido de compra ainda.</div>
      )}
    </div>
  );
}
