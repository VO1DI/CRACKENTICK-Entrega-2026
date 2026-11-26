/**
 * Regresiones de concurrencia: voucher, anulación, stock e instalación.
 * Usa una base temporal y no toca la base real.
 *
 * Uso: node pruebas/probar-concurrencia.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/crackentick_test_concurrency';

const Router = require('../models/Router');
const Plan = require('../models/Plan');
const Sale = require('../models/Sale');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');
const Invoice = require('../models/Invoice');
const InventoryItem = require('../models/InventoryItem');
const HotspotVoucher = require('../models/HotspotVoucher');
const FinanceEntry = require('../models/FinanceEntry');
const hotspotService = require('../services/hotspotService');
const inventoryService = require('../services/inventoryService');
const billingService = require('../services/billingService');
const salesService = require('../services/salesService');
const routerService = require('../services/routerService');
const Counter = require('../models/Counter');
const { asegurarContadores } = require('../services/counterService');

async function codigosSimultaneos() {
  await Counter.deleteMany({});
  await mongoose.connection.db.collection('sales').insertOne({ code: 'VEN-0007', status: 'cancelled' });
  await asegurarContadores();
  const codigos = await Promise.all(Array.from({ length: 10 }, () => Sale.siguienteCodigo()));
  assert.strictEqual(new Set(codigos).size, 10, 'los códigos deben ser únicos');
  assert.ok(codigos.includes('VEN-0008'), 'debe continuar desde el último código existente');
  assert.ok(codigos.every((codigo) => /^VEN-\d{4}$/.test(codigo)), 'el formato debe conservarse');
}

async function voucherDosVeces() {
  const router = await Router.create({ name: 'Concurrencia', vendor: 'mikrotik', host: '127.0.0.1', username: 'x' });
  await HotspotVoucher.create({
    batchId: new mongoose.Types.ObjectId(),
    routerId: router._id,
    code: 'CONC001',
    password: '1234',
    price: 10,
    status: 'available',
  });
  const [a, b] = await Promise.all([HotspotVoucher.findOne({ code: 'CONC001' }), HotspotVoucher.findOne({ code: 'CONC001' })]);
  const resultados = await Promise.allSettled([hotspotService.vender(a, router), hotspotService.vender(b, router)]);
  const entradas = await FinanceEntry.countDocuments({ reference: 'HOTSPOT-CONC001' });
  assert.strictEqual(resultados.filter((r) => r.status === 'fulfilled').length, 1, 'solo una venta debe ganar');
  assert.strictEqual(entradas, 1, 'no debe haber doble ingreso');
}

async function anularDosVeces() {
  const item = await InventoryItem.create({ code: 'CONC-BULK', name: 'Cable', tracking: 'bulk', quantity: 10, price: 1 });
  const invoice = await Invoice.create({
    invoiceNumber: 'CONC-INV-1',
    clientId: new mongoose.Types.ObjectId(),
    type: 'sale',
    lines: [{ description: 'Cable', quantity: 2, unitPrice: 1, amount: 2, inventoryItemId: item._id }],
    subtotal: 2,
    taxRate: 0,
    tax: 0,
    total: 2,
    issueDate: new Date(),
    dueDate: new Date(),
    status: 'open',
    affectsService: false,
  });
  await Promise.allSettled([
    billingService.anular(invoice._id, { reason: 'concurrencia A' }),
    billingService.anular(invoice._id, { reason: 'concurrencia B' }),
  ]);
  const despues = await InventoryItem.findById(item._id);
  assert.strictEqual(despues.quantity, 12, 'anular dos veces debe devolver el stock una sola vez');
}

async function ajustesSimultaneos() {
  const item = await InventoryItem.create({ code: 'CONC-STOCK', name: 'Conector', tracking: 'bulk', quantity: 10, price: 1 });
  await Promise.allSettled([
    inventoryService.ajustar(item._id, { delta: 5, reason: 'A' }),
    inventoryService.ajustar(item._id, { delta: 3, reason: 'B' }),
  ]);
  const despues = await InventoryItem.findById(item._id);
  assert.strictEqual(despues.quantity, 18, 'dos ajustes no deben pisarse');
}

async function restaurarLineasDuplicadas() {
  const item = await InventoryItem.create({ code: 'CONC-DUP', name: 'Cable doble', tracking: 'bulk', quantity: 0, price: 1 });
  const invoice = await Invoice.create({
    invoiceNumber: 'CONC-INV-DUP',
    clientId: new mongoose.Types.ObjectId(),
    type: 'sale',
    lines: [
      { description: 'Cable A', quantity: 1, unitPrice: 1, amount: 1, inventoryItemId: item._id },
      { description: 'Cable B', quantity: 1, unitPrice: 1, amount: 1, inventoryItemId: item._id },
    ],
    subtotal: 2,
    taxRate: 0,
    tax: 0,
    total: 2,
    issueDate: new Date(),
    dueDate: new Date(),
    status: 'open',
    affectsService: false,
  });
  await billingService.anular(invoice._id, { reason: 'líneas duplicadas' });
  const despues = await InventoryItem.findById(item._id);
  assert.strictEqual(despues.quantity, 2, 'debe restaurar las dos líneas del mismo artículo');
}

async function macUnica() {
  await Sale.init();
  const base = {
    status: 'waiting',
    customer: { firstName: 'Mac', lastName: 'Prueba' },
    service: { connectionType: 'pppoe', macAddress: 'AA:BB:CC:DD:EE:99', macAuthEnabled: true },
  };
  const resultados = await Promise.allSettled([
    Sale.create({ ...base, code: 'CONC-MAC-A' }),
    Sale.create({ ...base, code: 'CONC-MAC-B' }),
  ]);
  const rechazados = resultados.filter((r) => r.status === 'rejected' && r.reason.code === 11000);
  assert.strictEqual(rechazados.length, 1, 'la MAC debe ser única en ventas en espera');
  await Sale.deleteMany({ code: /^CONC-MAC-/ });
}

async function instalarDosVeces() {
  const router = await Router.create({ name: 'Concurrencia 2', vendor: 'mikrotik', host: '127.0.0.1', username: 'x', planMode: 'simple_queue' });
  const plan = await Plan.create({
    name: 'Plan concurrencia',
    downloadSpeed: 10,
    uploadSpeed: 5,
    price: 10,
    billingInterval: 'monthly',
    trafficMode: 'simple_queue',
    active: true,
  });
  const venta = await Sale.create({
    code: 'CONC-VEN-1',
    status: 'waiting',
    customer: { firstName: 'Ana', lastName: 'Prueba' },
    service: { planId: plan._id, routerId: router._id, connectionType: 'pppoe' },
    installationCost: 10,
    subtotal: 10,
    taxRatePercent: 0,
    tax: 0,
    total: 10,
  });

  const original = routerService.aprovisionar;
  routerService.aprovisionar = async () => ({ ok: true, simulated: true, result: 'stub' });
  try {
    const resultados = await Promise.allSettled([
      salesService.instalar(venta._id),
      salesService.instalar(venta._id),
    ]);
    assert.strictEqual(resultados.filter((r) => r.status === 'fulfilled').length, 1, 'solo una instalación debe ganar');
  } finally {
    routerService.aprovisionar = original;
  }

  assert.strictEqual(await Client.countDocuments(), 1, 'no debe duplicar el cliente');
  assert.strictEqual(await Subscription.countDocuments(), 1, 'no debe duplicar el servicio');
  assert.strictEqual(await Invoice.countDocuments({ saleId: venta._id }), 1, 'no debe duplicar la factura');
  const final = await Sale.findById(venta._id);
  assert.strictEqual(final.status, 'installed');
}

async function reintentarInstalacion() {
  const router = await Router.create({ name: 'Concurrencia 3', vendor: 'mikrotik', host: '127.0.0.1', username: 'x', planMode: 'simple_queue' });
  const plan = await Plan.create({
    name: 'Plan reintento',
    downloadSpeed: 10,
    uploadSpeed: 5,
    price: 10,
    billingInterval: 'monthly',
    trafficMode: 'simple_queue',
    active: true,
  });
  const item = await InventoryItem.create({ code: 'CONC-INST', name: 'Router', tracking: 'bulk', quantity: 5, price: 20 });
  const venta = await Sale.create({
    code: 'CONC-VEN-2',
    status: 'waiting',
    customer: { firstName: 'Luis', lastName: 'Reintento' },
    service: { planId: plan._id, routerId: router._id, connectionType: 'pppoe' },
    items: [{ itemId: item._id, name: 'Router', tracking: 'bulk', quantity: 1, unitPrice: 20, amount: 20 }],
    subtotal: 20,
    taxRatePercent: 0,
    tax: 0,
    total: 20,
  });

  const original = routerService.aprovisionar;
  routerService.aprovisionar = async () => ({ ok: true, simulated: true, result: 'stub' });
  try {
    await salesService.instalar(venta._id);
    assert.strictEqual((await InventoryItem.findById(item._id)).quantity, 4, 'la primera instalación descuenta una unidad');

    /* Simula un corte tras consumir stock y facturar: la venta vuelve a espera. */
    await Sale.updateOne({ _id: venta._id }, { $set: { status: 'waiting', installStartedAt: null } });
    await salesService.instalar(venta._id);
  } finally {
    routerService.aprovisionar = original;
  }

  assert.strictEqual((await InventoryItem.findById(item._id)).quantity, 4, 'el reintento no debe descontar stock otra vez');
  assert.strictEqual(await Invoice.countDocuments({ saleId: venta._id }), 1, 'el reintento no debe duplicar la factura');
  assert.strictEqual(await Subscription.countDocuments({ saleId: venta._id }), 1, 'el reintento no debe duplicar el servicio');
  assert.strictEqual((await Sale.findById(venta._id)).status, 'installed');
}

(async () => {
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  try {
    await codigosSimultaneos();
    await macUnica();
    await voucherDosVeces();
    await anularDosVeces();
    await restaurarLineasDuplicadas();
    await ajustesSimultaneos();
    await instalarDosVeces();
    await reintentarInstalacion();
    console.log('OK  Concurrencia: voucher, anulación, stock, instalación y reintento resisten dos peticiones.');
  } finally {
    await mongoose.connection.db.dropDatabase().catch(() => null);
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
