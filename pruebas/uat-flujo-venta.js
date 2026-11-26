/**
 * UAT del flujo de venta con roles reales:
 * promotor crea la venta, técnico completa e instala, finanzas cobra.
 *
 * Requiere una app corriendo con una base sembrada y un CHR accesible.
 * Uso: BASE=http://127.0.0.1:3102 node pruebas/uat-flujo-venta.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');
const Invoice = require('../models/Invoice');
const Plan = require('../models/Plan');
const Router = require('../models/Router');
const User = require('../models/User');
const routeros = require('../services/routeros');
const { cifrar } = require('../services/cryptoService');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const MARCA = `UAT-${Date.now()}`;

const galletas = (res) =>
  (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')])
    .filter(Boolean)
    .map((c) => c.split(';')[0])
    .join('; ');

async function login(usuario, password) {
  const previa = await fetch(`${BASE}/login`);
  const html = await previa.text();
  const token = (html.match(/name="csrf-token" content="([^"]+)"/) || [])[1];
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: galletas(previa) },
    body: new URLSearchParams({ usuario, password, _csrf: token }),
  });
  assert.strictEqual(res.status, 302, `login de ${usuario}`);
  const cookie = galletas(res);
  const pagina = await fetch(`${BASE}/`, { headers: { Cookie: cookie } });
  const panel = await pagina.text();
  return { cookie, csrf: (panel.match(/name="csrf-token" content="([^"]+)"/) || [])[1] };
}

async function post(ruta, sesion, datos) {
  const res = await fetch(BASE + ruta, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sesion.cookie },
    body: new URLSearchParams({ ...datos, _csrf: sesion.csrf }),
  });
  return res;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const tecnico = await User.findOne({ username: 'tecnico' }).select('_id name').lean();
  const promotor = await User.findOne({ username: 'ventas' }).select('_id name').lean();
  const plan = await Plan.findOne({ active: true, trafficMode: 'simple_queue' }).lean();
  const router = await Router.findOne({ name: /CHR QEMU/ }).select('+passwordEnc').lean();
  assert.ok(tecnico && promotor && plan && router, 'faltan datos sembrados');

  console.log('1. Promotor crea la venta sin servicio');
  const sesionPromotor = await login('ventas', 'ventas123');
  const crear = await post('/ventas', sesionPromotor, {
    firstName: 'UAT',
    lastName: MARCA,
    phone: '04140000000',
    installationCost: '10',
    technicianId: String(tecnico._id),
    promoterId: String(promotor._id),
    notes: MARCA,
  });
  assert.strictEqual(crear.status, 302, 'el promotor debe crear la venta');
  const venta = await Sale.findOne({ notes: MARCA });
  assert.ok(venta, 'la venta quedó guardada');
  assert.ok(!venta.service?.planId && !venta.service?.routerId, 'la venta no debe exigir servicio');
  console.log('   venta', venta.code, 'sin plan/router: OK');

  console.log('2. Técnico completa el servicio');
  const sesionTecnico = await login('tecnico', 'tecnico123');
  const completar = await post(`/ventas/${venta._id}/servicio/editar`, sesionTecnico, {
    planId: String(plan._id),
    routerId: String(router._id),
    connectionType: 'pppoe',
    pppoeUsername: `uat${String(venta.code).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    ipAddress: '10.10.9.50',
  });
  assert.strictEqual(completar.status, 302, 'el técnico debe completar el servicio');

  console.log('3. Técnico instala la venta');
  const instalar = await post(`/ventas/${venta._id}/instalar`, sesionTecnico, {});
  assert.strictEqual(instalar.status, 302, 'la instalación debe completarse');
  const instalada = await Sale.findById(venta._id).lean();
  assert.strictEqual(instalada.status, 'installed');
  const cliente = await Client.findById(instalada.clientId).lean();
  const servicio = await Subscription.findOne({ clientId: instalada.clientId }).lean();
  const factura = await Invoice.findById(instalada.invoiceId).lean();
  assert.ok(cliente && servicio && factura, 'cliente, servicio y factura creados');
  console.log('   cliente', cliente.clientCode, '| servicio', servicio._id.toString(), '| factura', factura.invoiceNumber);

  console.log('4. Finanzas cobra la factura');
  const sesionFinanzas = await login('finanzas', 'finanzas123');
  const pagar = await post(`/facturas/${factura._id}/pagar`, sesionFinanzas, {
    paymentMethod: 'cash',
    paymentCurrency: 'USD',
    paymentReference: MARCA,
  });
  assert.strictEqual(pagar.status, 302, 'el cobro debe completarse');
  const pagada = await Invoice.findById(factura._id).lean();
  assert.strictEqual(pagada.status, 'paid');
  console.log('   factura', pagada.invoiceNumber, 'pagada: OK');

  console.log('5. Verificación en el CHR');
  const routerDoc = { ...router, _id: router._id, passwordEnc: router.passwordEnc || cifrar(process.env.CHR_API_PASSWORD || '') };
  const api = await routeros.conectar(routerDoc);
  try {
    const secretos = await api.write('/ppp/secret/print');
    const secreto = secretos.find((s) => s.name === servicio.serviceConfig.pppoeUsername);
    assert.ok(secreto, 'el secreto PPPoE existe en el CHR');
    console.log('   secreto', secreto.name, 'perfil', secreto.profile, 'remoto', secreto['remote-address']);
  } finally {
    routeros.cerrar(api);
  }

  console.log(`\nUAT OK · ${MARCA} · venta ${venta.code} · cliente ${cliente.clientCode} · factura ${pagada.invoiceNumber}`);
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('UAT FALLO:', error.message);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
