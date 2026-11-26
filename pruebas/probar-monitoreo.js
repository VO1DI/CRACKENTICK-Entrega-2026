/**
 * Pruebas de la configuración de monitorización e ICMP.
 * Uso: node pruebas/probar-monitoreo.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Settings = require('../models/Settings');
const settingsCache = require('../services/settingsCache');
const monitoringService = require('../services/monitoringService');
const icmpService = require('../services/icmpService');

(async () => {
  assert.strictEqual(icmpService.hostValido('127.0.0.1'), true);
  assert.strictEqual(icmpService.hostValido('192.168.88.1'), true);
  assert.strictEqual(icmpService.hostValido('-t'), false);
  assert.strictEqual(icmpService.hostValido('host con espacio'), false);
  const local = await icmpService.ping('127.0.0.1', 1000);
  assert.strictEqual(local.ok, true, 'localhost debe responder a ICMP');

  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_monitoring');
  const settings = await Settings.getSingleton();
  if (!settings.monitoring) settings.monitoring = {};
  settings.monitoring.intervalMs = 7000;
  settings.monitoring.downDelayMs = 45000;
  settings.monitoring.icmpEnabled = true;
  settings.monitoring.icmpTimeoutMs = 1500;
  await settings.save();
  settingsCache.invalidar();

  const config = await monitoringService.configuracion();
  assert.deepStrictEqual(config, { intervalMs: 7000, downDelayMs: 45000, icmpEnabled: true, icmpTimeoutMs: 1500 });

  const controller = require('../controllers/monitoringController');
  let destino = '';
  const req = {
    body: { intervalSec: '9', downDelaySec: '20', icmpTimeoutMs: '1200', icmpEnabled: 'on' },
    usuario: { username: 'prueba' },
    flash: () => {},
  };
  const res = { redirect: (url) => { destino = url; }, render: () => {}, status: () => res };
  await controller.guardarConfiguracion(req, res, (error) => { throw error; });
  assert.strictEqual(destino, '/red/monitoreo/configuracion');
  const guardada = await Settings.getSingleton();
  assert.deepStrictEqual(
    { intervalMs: guardada.monitoring.intervalMs, downDelayMs: guardada.monitoring.downDelayMs, icmpEnabled: guardada.monitoring.icmpEnabled, icmpTimeoutMs: guardada.monitoring.icmpTimeoutMs },
    { intervalMs: 9000, downDelayMs: 20000, icmpEnabled: true, icmpTimeoutMs: 1200 }
  );

  console.log('OK  Monitorización: ICMP local, hosts inválidos y configuración persistida.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
