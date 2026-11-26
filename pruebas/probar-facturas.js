/**
 * Regresión de facturas manuales: el stock se descuenta antes de crear la
 * factura; si no alcanza, no queda una factura huérfana.
 *
 * Uso: node pruebas/probar-facturas.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const InventoryItem = require('../models/InventoryItem');
const Invoice = require('../models/Invoice');
const Sale = require('../models/Sale');
const billingService = require('../services/billingService');
const inventoryService = require('../services/inventoryService');
const { redondear } = require('../utils/money');
const invoiceController = require('../controllers/invoiceController');

function respuesta() {
  const estado = { redireccion: '', vista: '', datos: null };
  const res = {
    redirect: (url) => { estado.redireccion = url; },
    render: (vista, datos) => { estado.vista = vista; estado.datos = datos; },
    status: () => res,
  };
  return { res, estado };
}

function cuerpo(clientId, itemId, cantidad) {
  return {
    clientId: String(clientId),
    description: ['Cable'],
    quantity: [String(cantidad)],
    unitPrice: ['1'],
    inventoryItemId: [String(itemId)],
    type: 'sale',
    taxRatePercent: '0',
  };
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_invoices');
  await mongoose.connection.db.dropDatabase();
  const cliente = await Client.create({ clientCode: 'CL-FACT', firstName: 'Ana', lastName: 'Prueba' });
  const item = await InventoryItem.create({ code: 'FACT-CABLE', name: 'Cable', tracking: 'bulk', quantity: 5, price: 1 });

  const ok = respuesta();
  await invoiceController.crear(
    { body: cuerpo(cliente._id, item._id, 1), usuario: { username: 'test' }, flash: () => {} },
    ok.res,
    (error) => { throw error; }
  );
  assert.ok(ok.estado.redireccion.startsWith('/facturas/'), 'la factura debe crearse');
  assert.strictEqual(await Invoice.countDocuments({ clientId: cliente._id }), 1);
  assert.strictEqual((await InventoryItem.findById(item._id)).quantity, 4, 'debe descontar 1');

  const fallo = respuesta();
  await invoiceController.crear(
    { body: cuerpo(cliente._id, item._id, 99), usuario: { username: 'test' }, flash: () => {} },
    fallo.res,
    (error) => { throw error; }
  );
  assert.strictEqual(await Invoice.countDocuments({ clientId: cliente._id }), 1, 'no debe crear factura si falta stock');
  assert.strictEqual((await InventoryItem.findById(item._id)).quantity, 4, 'no debe descontar si falla');

  // Dos líneas del mismo artículo no pueden superar juntas el stock.
  const itemDoble = await InventoryItem.create({ code: 'FACT-DOBLE', name: 'Cable doble', tracking: 'bulk', quantity: 5, price: 1 });
  await assert.rejects(
    inventoryService.consumirLineas(
      [
        { itemId: itemDoble._id, name: 'Cable doble', quantity: 4 },
        { itemId: itemDoble._id, name: 'Cable doble', quantity: 4 },
      ],
      { actor: 'test' }
    ),
    /Stock insuficiente/,
    'dos líneas del mismo artículo deben validarse juntas'
  );
  assert.strictEqual((await InventoryItem.findById(itemDoble._id)).quantity, 5, 'no debe descontar nada si la suma excede');

  // Medio céntimo: 4.015 debe redondear a 4.02.
  assert.strictEqual(redondear(4.015), 4.02, 'el redondeo debe subir el medio céntimo');
  assert.strictEqual(redondear(10.075), 10.08, 'el redondeo debe ser estable con otros valores');

  // Un cobro en efectivo USD no necesita tasa BCV.
  const facturaEfectivo = await Invoice.create({
    invoiceNumber: 'F-USD-1',
    clientId: cliente._id,
    type: 'service',
    dueDate: new Date(),
    lines: [{ description: 'Servicio', quantity: 1, unitPrice: 10, amount: 10 }],
    subtotal: 10,
    taxRate: 0,
    tax: 0,
    total: 10,
    status: 'open',
    affectsService: false,
  });
  const pago = await billingService.pagar(facturaEfectivo._id, {
    paymentCurrency: 'USD',
    paymentMethod: 'cash',
    exchangeRate: 0,
    actor: 'test',
  });
  assert.strictEqual(pago.factura.status, 'paid', 'el pago USD debe completarse sin tasa');
  assert.strictEqual(pago.factura.paymentAmount, 10, 'el monto en USD debe ser el total');

  // Un cobro en bolívares usa la tasa manual indicada.
  const facturaBs = await Invoice.create({
    invoiceNumber: 'F-BS-1',
    clientId: cliente._id,
    type: 'service',
    dueDate: new Date(),
    lines: [{ description: 'Servicio', quantity: 1, unitPrice: 10, amount: 10 }],
    subtotal: 10,
    taxRate: 0,
    tax: 0,
    total: 10,
    status: 'open',
    affectsService: false,
  });
  const pagoBs = await billingService.pagar(facturaBs._id, {
    paymentCurrency: 'VES',
    paymentMethod: 'transfer',
    exchangeRate: 50,
    actor: 'test',
  });
  assert.strictEqual(pagoBs.factura.paymentAmount, 500, '10 USD a tasa 50 son 500 Bs');
  assert.strictEqual(pagoBs.factura.exchangeRate, 50, 'debe guardar la tasa manual');

  const facturaSinTasa = await Invoice.create({
    invoiceNumber: 'F-BS-2',
    clientId: cliente._id,
    type: 'service',
    dueDate: new Date(),
    lines: [{ description: 'Servicio', quantity: 1, unitPrice: 3, amount: 3 }],
    subtotal: 3,
    taxRate: 0,
    tax: 0,
    total: 3,
    status: 'open',
    affectsService: false,
  });
  await assert.rejects(
    billingService.pagar(facturaSinTasa._id, {
      paymentCurrency: 'VES',
      paymentMethod: 'transfer',
      exchangeRate: 0,
      actor: 'test',
    }),
    /tasa válida/,
    'cobrar en Bs sin tasa debe fallar'
  );

  // Una factura de venta ya instalada no se puede anular.
  const ventaInstalada = await Sale.create({ code: 'V-INST-1', status: 'installed', clientId: cliente._id });
  const facturaInstalada = await Invoice.create({
    invoiceNumber: 'F-INST-1',
    clientId: cliente._id,
    saleId: ventaInstalada._id,
    type: 'installation',
    dueDate: new Date(),
    lines: [{ description: 'Equipo', quantity: 1, unitPrice: 20, amount: 20 }],
    subtotal: 20,
    taxRate: 0,
    tax: 0,
    total: 20,
    status: 'open',
    affectsService: false,
  });
  await assert.rejects(
    billingService.anular(facturaInstalada._id, { reason: 'prueba', actor: 'test' }),
    /ya está instalada/,
    'no debe anular una factura de venta instalada'
  );
  assert.strictEqual((await Invoice.findById(facturaInstalada._id)).status, 'open', 'la factura bloqueada no cambia');

  // Ampliar el vencimiento devuelve la factura vencida a pendiente.
  const facturaVencida = await Invoice.create({
    invoiceNumber: 'F-VENC-1',
    clientId: cliente._id,
    type: 'service',
    dueDate: new Date(Date.now() - 86400000),
    lines: [{ description: 'Servicio', quantity: 1, unitPrice: 5, amount: 5 }],
    subtotal: 5,
    taxRate: 0,
    tax: 0,
    total: 5,
    status: 'overdue',
    affectsService: false,
  });
  const futura = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await billingService.actualizarFactura(facturaVencida._id, {
    taxRatePercent: 0,
    discountType: 'none',
    discount: 0,
    dueDate: futura,
    notes: '',
    actor: 'test',
  });
  assert.strictEqual((await Invoice.findById(facturaVencida._id)).status, 'open', 'con fecha futura deja de estar vencida');

  console.log('OK  Facturas: descuenta antes de crear, no deja factura huérfana sin stock, redondeo y cobro/cancelación seguros.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
