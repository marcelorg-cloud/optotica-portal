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

const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPTOTICA_COMPANY_ID'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Variável obrigatória ausente: ${name}`);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const companyId = process.env.OPTOTICA_COMPANY_ID;
const unitId = process.env.OPTOTICA_UNIT_ID || null;

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
  if (status.includes('produ')) return 'lens_production';
  if (status.includes('confirm')) return 'confirmed';
  return 'draft';
}

for (const patient of patients) {
  const customer = patient.customer || {};
  const { data: client, error: clientError } = await supabase.from('clients').upsert({
    company_id: companyId,
    unit_id: unitId,
    full_name: customer.name || 'Cliente migrado',
    whatsapp_e164: phoneE164(customer.whatsapp || patient.phone),
    email: customer.email || null,
    dnp_od: decimal(customer.dnpOd),
    dnp_oe: decimal(customer.dnpOe),
    active: true
  }, { onConflict: 'company_id,whatsapp_e164' }).select('id').single();
  if (clientError) throw clientError;

  for (const legacy of patient.orders || []) {
    const orderNumber = Number(legacy.number ?? legacy.numero);
    const { data: order, error: orderError } = await supabase.from('orders').upsert({
      company_id: companyId,
      unit_id: unitId,
      client_id: client.id,
      order_number: orderNumber,
      status: orderStatus(legacy.status),
      final_amount: decimal(legacy.finalValue)
    }, { onConflict: 'company_id,order_number' }).select('id').single();
    if (orderError) throw orderError;

    const rx = legacy.prescription || {};
    const hasPrescription = Object.values(rx.od || {}).some(Boolean) || Object.values(rx.oe || {}).some(Boolean);
    if (hasPrescription) {
      const { error } = await supabase.from('prescriptions').upsert({
        company_id: companyId,
        order_id: order.id,
        od_sphere: decimal(rx.od?.esf), od_cylinder: decimal(rx.od?.cil), od_axis: decimal(rx.od?.eixo), od_addition: decimal(rx.od?.adicao),
        oe_sphere: decimal(rx.oe?.esf), oe_cylinder: decimal(rx.oe?.cil), oe_axis: decimal(rx.oe?.eixo), oe_addition: decimal(rx.oe?.adicao)
      }, { onConflict: 'order_id' });
      if (error) throw error;
    }

    for (const [budgetIndex, budget] of (legacy.budgets || []).entries()) {
      const { error } = await supabase.from('budgets').upsert({
        company_id: companyId,
        order_id: order.id,
        legacy_key: String(budget.id || `${orderNumber}-${budgetIndex + 1}`),
        details: budget.details || legacy.lensDraft?.type || 'Lente migrada',
        laboratory: budget.lab || legacy.lensDraft?.lab || null,
        amount: decimal(budget.price) || 0,
        notes: budget.obs || null
      }, { onConflict: 'order_id,legacy_key' });
      if (error) throw error;
    }

    if (legacy.selectedFrame?.name) {
      const { error } = await supabase.from('order_frames').upsert({
        company_id: companyId,
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
