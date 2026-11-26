/**
 * Regresión: si RouterOS rechaza el aprovisionamiento, la venta no se marca instalada
 * y se revierten cliente, servicio, factura y stock.
 * Uso: node pruebas/probar-venta-fallida.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Router = require('../models/Router');
const Plan = require('../models/Plan');
const Sale = require('../models/Sale');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');
const Invoice = require('../models/Invoice');
const InventoryItem = require('../models/InventoryItem');
const routerService = require('../services/routerService');
const salesService = require('../services/salesService');

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_venta_fallida');
  await mongoose.connection.dropDatabase();

  const router = await Router.create({
    name: 'Router prueba',
    vendor: 'mikrotik',
    host: '127.0.0.1',
    username: 'api',
    planMode: 'simple_queue',
    mode: 'real',
    active: true,
  });
  const plan = await Plan.create({
    name: 'Plan prueba',
    downloadSpeed: 10,
    uploadSpeed: 5,
    price: 10,
    billingInterval: 'monthly',
    trafficMode: 'simple_queue',
    active: true,
  });
  const cable = await InventoryItem.create({ code: 'FALLA-CABLE', name: 'Cable', tracking: 'bulk', quantity: 5, price: 1 });
  const venta = await Sale.create({
    code: 'FALLA-1',
    status: 'waiting',
    customer: { firstName: 'Ana', lastName: 'Falla' },
    service: { planId: plan._id, routerId: router._id, connectionType: 'pppoe', pppoeUsername: 'falla1' },
    items: [{ itemId: cable._id, name: 'Cable', tracking: 'bulk', quantity: 2, unitPrice: 1, amount: 2 }],
    materialsTotal: 2,
    installationCost: 10,
    subtotal: 12,
    total: 12,
  });

  let eliminadoEnRouter = false;
  routerService.aprovisionar = async (subscription, { accion } = {}) => {
    if (accion === 'delete') {
      eliminadoEnRouter = true;
      return { ok: true, resultados: [{ ok: true, result: 'limpio' }] };
    }
    return { ok: false, resultados: [{ ok: false, result: 'router rechazó el secret' }] };
  };

  let error = null;
  try {
    await salesService.instalar(venta._id, { actor: 'prueba' });
  } catch (capturado) {
    error = capturado;
  }

  assert.ok(error, 'la instalación debe fallar');
  assert.strictEqual(error.status, 502, 'debe devolver 502 de router');
  const despues = await Sale.findById(venta._id).lean();
  assert.strictEqual(despues.status, 'waiting', 'la venta sigue en espera');
  assert.strictEqual(despues.installStartedAt, null, 'se libera el bloqueo de instalación');
  assert.strictEqual(await Client.countDocuments(), 0, 'no debe quedar cliente');
  assert.strictEqual(await Subscription.countDocuments(), 0, 'no debe quedar servicio');
  assert.strictEqual(await Invoice.countDocuments(), 0, 'no debe quedar factura');
  assert.strictEqual(eliminadoEnRouter, true, 'debe intentar limpiar el router');
  assert.strictEqual((await InventoryItem.findById(cable._id)).quantity, 5, 'el stock vuelve a su valor tras el fallo');

  // Reintento: ya no hay que consumir stock dos veces ni saltarse el descuento.
  routerService.aprovisionar = async () => ({ ok: true, resultados: [{ ok: true, result: 'creado' }] });
  const segunda = await salesService.instalar(venta._id, { actor: 'prueba' });
  assert.strictEqual(segunda.venta.status, 'installed', 'el reintento debe instalar la venta');
  assert.strictEqual((await InventoryItem.findById(cable._id)).quantity, 3, 'el reintento descuenta exactamente una vez');

  console.log('OK  Venta: router rechazado no marca instalada y revierte los registros.');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
