/**
 * Regresión: en Caja solo cuentan ingresos cobrados; en Devengo cuentan los pendientes.
 * Uso: node pruebas/probar-economia.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const FinanceEntry = require('../models/FinanceEntry');
const economicsService = require('../services/economicsService');

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_economia');
  await mongoose.connection.dropDatabase();

  const ahora = new Date();
  const clave = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
  const base = { cantidad: 1, mesActivo: clave };

  await FinanceEntry.create({
    type: 'income',
    category: 'otros',
    concept: 'Ingreso pendiente',
    amount: 100,
    amountUsd: 100,
    currency: 'USD',
    status: 'pending',
    paymentMethod: 'cash',
    date: ahora,
  });

  const cajaPendiente = (await economicsService.serieEconomica(ahora, { ...base, base: 'caja' }))[0];
  assert.strictEqual(cajaPendiente.manualIngresos, 0, 'Caja no debe contar ingresos pendientes');
  assert.strictEqual(cajaPendiente.utilidadNeta, 0, 'Caja no debe inflar la utilidad');

  const devengoPendiente = (await economicsService.serieEconomica(ahora, { ...base, base: 'devengo' }))[0];
  assert.strictEqual(devengoPendiente.manualIngresos, 100, 'Devengo sí debe contar lo pendiente');

  await FinanceEntry.updateMany({}, { $set: { status: 'paid' } });
  const cajaPagada = (await economicsService.serieEconomica(ahora, { ...base, base: 'caja' }))[0];
  assert.strictEqual(cajaPagada.manualIngresos, 100, 'Caja debe contar lo cobrado');

  await FinanceEntry.deleteMany({});
  await FinanceEntry.create({
    type: 'expense',
    category: 'inventario',
    concept: 'Compra de equipos',
    amount: 50,
    amountUsd: 50,
    currency: 'USD',
    status: 'paid',
    date: ahora,
  });
  const conInventario = (await economicsService.serieEconomica(ahora, { ...base, base: 'caja' }))[0];
  assert.strictEqual(conInventario.gastosOperativos, 0, 'La compra de inventario es activo, no gasto');
  assert.strictEqual(conInventario.comprasInventario, 50, 'La compra se informa aparte');
  assert.strictEqual(conInventario.utilidadNeta, 0, 'La compra de inventario no resta utilidad');

  console.log('OK  Economía: caja solo cobrado, devengo pendiente e inventario fuera de utilidad.');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
