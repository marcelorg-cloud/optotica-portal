#!/usr/bin/env node

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const inputPath = process.argv.find(arg => arg.endsWith('.json'));
const apply = process.argv.includes('--apply');
if (!inputPath) throw new Error('Informe o arquivo migration-output/valid-orders.json.');

const patients = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const orders = patients.flatMap(patient => patient.orders || []);
const numbers = orders.map(order => String(order.number ?? order.numero)).sort();
if (numbers.join(',') !== '1287,1288') throw new Error(`Carga recusada: pedidos ${numbers.join(',') || 'nenhum'}.`);

if (!apply) {
  console.log('Validação concluída: 1 cliente e 2 pedidos (#1287 e #1288).');
  console.log('Nenhum dado foi enviado. Use --apply após validar o projeto e as variáveis.');
  process.exit(0);
}

const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPTOTICA_ORGANIZATION_ID'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Variável obrigatória ausente: ${name}`);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const organizationId = process.env.OPTOTICA_ORGANIZATION_ID;
const professionalId = process.env.OPTOTICA_PROFESSIONAL_ID || null;

function phoneE164(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return `+${digits.startsWith('55') ? digits : `55${digits}`}`;
}

function decimal(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function orderStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status.includes('entreg')) return 'delivered';
  if (status.includes('produ')) return 'in_production';
  if (status.includes('confirm') || status.includes('aprov')) return 'approved';
  return 'in_progress';
}

for (const patient of patients) {
  const customer = patient.customer || {};
  const { data: client, error: clientError } = await supabase.from('clients').upsert({
    organization_id: organizationId,
    full_name: customer.name || 'Cliente migrado',
    whatsapp_e164: phoneE164(customer.whatsapp || patient.phone),
    email: customer.email || null,
    status: 'active'
  }, { onConflict: 'organization_id,whatsapp_e164' }).select('id').single();
  if (clientError) throw clientError;

  for (const legacy of patient.orders || []) {
    const orderNumber = Number(legacy.number ?? legacy.numero);
    const { data: order, error: orderError } = await supabase.from('orders').upsert({
      organization_id: organizationId,
      client_id: client.id,
      professional_id: professionalId,
      order_number: orderNumber,
      status: orderStatus(legacy.status),
      total: decimal(legacy.finalValue) || 0
    }, { onConflict: 'organization_id,order_number' }).select('id').single();
    if (orderError) throw orderError;

    const rx = legacy.prescription || {};
    const hasPrescription = Object.values(rx.od || {}).some(Boolean) || Object.values(rx.oe || {}).some(Boolean);
    if (hasPrescription) {
      const { error } = await supabase.from('prescriptions').upsert({
        organization_id: organizationId,
        client_id: client.id,
        order_id: order.id,
        professional_id: professionalId,
        prescription_data: {
          od: { sphere: decimal(rx.od?.esf), cylinder: decimal(rx.od?.cil), axis: decimal(rx.od?.eixo), addition: decimal(rx.od?.adicao) },
          oe: { sphere: decimal(rx.oe?.esf), cylinder: decimal(rx.oe?.cil), axis: decimal(rx.oe?.eixo), addition: decimal(rx.oe?.adicao) }
        }
      }, { onConflict: 'order_id' });
      if (error) throw error;
    }

    let quoteId = null;
    if ((legacy.budgets || []).length) {
      const quoteTotal = (legacy.budgets || []).reduce((sum, budget) => sum + (decimal(budget.price) || 0), 0);
      const { data: quote, error: quoteError } = await supabase.from('quotes').upsert({
        organization_id: organizationId,
        client_id: client.id,
        order_id: order.id,
        legacy_key: `order-${orderNumber}`,
        status: legacy.selectedBudgetId ? 'selected' : 'sent',
        total: quoteTotal
      }, { onConflict: 'organization_id,legacy_key' }).select('id').single();
      if (quoteError) throw quoteError;
      quoteId = quote.id;
    }

    for (const [budgetIndex, budget] of (legacy.budgets || []).entries()) {
      const { error } = await supabase.from('quote_items').upsert({
        quote_id: quoteId,
        legacy_key: String(budget.id || `${orderNumber}-${budgetIndex + 1}`),
        item_type: 'lens',
        description: budget.details || legacy.lensDraft?.type || 'Lente migrada',
        internal_code: null,
        quantity: 1,
        unit_price: decimal(budget.price) || 0,
        metadata: { laboratory: budget.lab || legacy.lensDraft?.lab || null, notes: budget.obs || null }
      }, { onConflict: 'quote_id,legacy_key' });
      if (error) throw error;
    }

    if (legacy.selectedFrame?.name) {
      const { error } = await supabase.from('order_frames').upsert({
        organization_id: organizationId,
        order_id: order.id,
        frame_name: legacy.selectedFrame.name,
        sku: legacy.selectedFrame.sku || null,
        color: legacy.selectedFrame.color || null,
        source: legacy.selectedFrame.origin || null
      }, { onConflict: 'order_id' });
      if (error) throw error;
    }
  }
}

console.log('Importação concluída: pedidos #1287 e #1288 preservados.');
