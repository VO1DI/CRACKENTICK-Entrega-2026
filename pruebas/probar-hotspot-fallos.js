/**
 * Regresión: si falla el guardado del voucher, se borra el usuario del router.
 * Uso: node pruebas/probar-hotspot-fallos.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Router = require('../models/Router');
const HotspotPlan = require('../models/HotspotPlan');
const HotspotBatch = require('../models/HotspotBatch');
const HotspotVoucher = require('../models/HotspotVoucher');
const routeros = require('../services/routeros');
const hotspotService = require('../services/hotspotService');

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_hotspot_fallo');
  await mongoose.connection.dropDatabase();

  const router = await Router.create({
    name: 'Router hotspot',
    vendor: 'mikrotik',
    host: '127.0.0.1',
    username: 'api',
    mode: 'real',
    hotspotEnabled: true,
    active: true,
  });
  const plan = await HotspotPlan.create({
    name: 'Prueba 1h',
    price: 1,
    durationMinutes: 60,
    downloadMbps: 5,
    uploadMbps: 2,
    active: true,
  });

  const comandos = [];
  routeros.ejecutar = async (routerDoc, cmd) => {
    comandos.push(cmd.path);
    return { ok: true, result: 'stub' };
  };
  HotspotVoucher.create = async () => {
    throw new Error('fallo de base simulado');
  };

  const resultado = await hotspotService.crearLote({
    router,
    planId: plan._id,
    cantidad: 1,
    actor: 'prueba',
  });

  assert.strictEqual(resultado.errores.length, 1, 'debe registrar el fallo de guardado');
  assert.strictEqual(resultado.vouchers.length, 0, 'no debe quedar voucher');
  assert.ok(comandos.includes('/ip/hotspot/user/remove'), 'debe borrar el usuario remoto huérfano');
  const lote = await HotspotBatch.findById(resultado.lote._id).lean();
  assert.strictEqual(lote.status, 'incomplete', 'el lote queda incompleto');

  console.log('OK  Hotspot: un fallo de base borra el usuario remoto y marca el lote incompleto.');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
