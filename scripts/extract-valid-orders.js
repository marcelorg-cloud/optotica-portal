#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const sourcePath = process.argv[2];
const outputPath = process.argv[3];
const validOrderNumbers = new Set(['1287', '1288']);

if (!sourcePath || !outputPath) {
  console.error('Uso: node scripts/extract-valid-orders.js <profiles.php> <saida.json>');
  process.exit(1);
}

const raw = fs.readFileSync(sourcePath, 'utf8').replace(/^<\?php exit; \?>\s*/, '');
const source = JSON.parse(raw);
const patients = source.__patients__ || {};
const migration = [];

for (const [patientKey, patient] of Object.entries(patients)) {
  const orders = Array.isArray(patient.orders)
    ? patient.orders
    : Object.values(patient.orders || {});
  const selectedOrders = orders.filter(order =>
    validOrderNumbers.has(String(order && (order.number ?? order.numero)))
  );

  if (selectedOrders.length > 0) {
    migration.push({
      patientKey,
      phone: patient.phone || null,
      customer: patient.customer || {},
      professional: patient.professional || {},
      orders: selectedOrders,
      createdAt: patient.createdAt || null,
      updatedAt: patient.updatedAt || null
    });
  }
}

const selectedNumbers = migration
  .flatMap(patient => patient.orders)
  .map(order => String(order.number ?? order.numero))
  .sort();

if (selectedNumbers.join(',') !== '1287,1288') {
  throw new Error(`Carga inválida: pedidos encontrados: ${selectedNumbers.join(',') || 'nenhum'}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(migration, null, 2) + '\n', { mode: 0o600 });
console.log('Exportação concluída: 2 pedidos válidos (#1287 e #1288).');
