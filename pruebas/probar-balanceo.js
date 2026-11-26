/**
 * Regresión: PCC elimina sin falsos errores y excluye redes conectadas.
 * Uso: node pruebas/probar-balanceo.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const routeros = require('../services/routeros');
const balanceService = require('../services/balanceService');

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_balance');
  await mongoose.connection.dropDatabase();

  const escritos = [];
  const api = {
    write: async (path, params = []) => {
      escritos.push({ path, params });
      if (path === '/ip/route/print') {
        return [
          { 'dst-address': '10.10.0.0/24', connect: 'true' },
          { 'dst-address': '0.0.0.0/0', connect: 'false' },
        ];
      }
      if (path === '/ip/firewall/filter/print') return [{ action: 'fasttrack-connection' }];
      return [];
    },
  };
  routeros.conectar = async () => api;
  routeros.cerrar = () => {};

  const config = {
    _id: new mongoose.Types.ObjectId(),
    method: 'pcc',
    lanInterface: 'bridge-lan',
    entries: [
      { gateway: '192.0.2.1', interface: 'ether1' },
      { gateway: '192.0.2.2', interface: 'ether2' },
    ],
  };
  const router = { _id: new mongoose.Types.ObjectId(), name: 'Router prueba', vendor: 'mikrotik', transport: 'api', mode: 'real' };

  const creado = await balanceService.aplicar(router, config, 'crear');
  assert.strictEqual(creado.ok, true, `PCC debe aplicar: ${creado.salida}`);
  const aceptar = escritos.findIndex((e) => e.path === '/ip/firewall/mangle/add' && e.params.includes('=action=accept'));
  const marcar = escritos.findIndex((e) => e.path === '/ip/firewall/mangle/add' && e.params.includes('=action=mark-connection'));
  assert.ok(aceptar !== -1, 'debe crear la regla de aceptación para la red interna');
  assert.ok(aceptar < marcar, 'la red interna se acepta antes de marcar');
  assert.ok(escritos.some((e) => e.path === '/ip/firewall/mangle/add' && e.params.includes('=dst-address=10.10.0.0/24')));
  assert.ok(escritos.some((e) => e.path === '/routing/table/add'));
  assert.ok(escritos.some((e) => e.path === '/ip/firewall/nat/add'));
  assert.ok(escritos.some((e) => e.path === '/ip/route/add' && e.params.some((p) => p.startsWith('=routing-table='))));
  assert.ok(creado.resultados.some((r) => /FastTrack/.test(r.result)), 'debe avisar de FastTrack');

  escritos.length = 0;
  const quitado = await balanceService.aplicar(router, config, 'eliminar');
  assert.strictEqual(quitado.ok, true, `PCC debe eliminar sin error: ${quitado.salida}`);
  assert.ok(quitado.resultados.some((r) => /PCC eliminado/.test(r.result)), 'debe informar la eliminación');

  console.log('OK  Balanceo: PCC aplica, excluye redes conectadas y elimina sin falso error.');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
