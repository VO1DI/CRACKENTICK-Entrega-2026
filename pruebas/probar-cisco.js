/**
 * Pruebas de integración de Cisco contra un simulador de consola IOS.
 * Uso: node pruebas/probar-cisco.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const { ObjectId } = require('mongoose').Types;
const sim = require('./cisco-sim/server');
const ciscoService = require('../services/ciscoService');
const vlanService = require('../services/vlanService');
const balanceService = require('../services/balanceService');
const planService = require('../services/planService');
const { cifrar } = require('../services/cryptoService');

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_cisco');
  const { COMANDOS } = sim;
  await sim.iniciar(2322);
  const router = {
    _id: new ObjectId(),
    name: 'Cisco simulado',
    vendor: 'cisco',
    mode: 'real',
    host: '127.0.0.1',
    port: 2322,
    username: 'admin',
    passwordEnc: cifrar('cisco'),
  };

  try {
    const prueba = await ciscoService.probar(router);
    assert.strictEqual(prueba.ok, true, 'show version debe responder');
    assert.ok(/Cisco IOS Software/.test(prueba.result));

    const respaldo = await ciscoService.respaldar(router);
    assert.ok(respaldo.includes('hostname Router'), 'el respaldo debe traer la configuracion');

    const vlan = { _id: new ObjectId(), vlanId: 10, name: 'VLAN Ventas', interface: 'GigabitEthernet0/1', address: '192.0.2.1/24' };
    const creada = await vlanService.aplicar(router, vlan, 'crear');
    assert.strictEqual(creada.ok, true, `VLAN: ${creada.salida}`);
    assert.ok(COMANDOS.some((c) => c === 'vlan 10'));
    assert.ok(COMANDOS.some((c) => c === 'name VLAN Ventas'));
    assert.ok(COMANDOS.some((c) => c === 'ip address 192.0.2.1 255.255.255.0'), 'Cisco usa máscara, no CIDR');

    COMANDOS.length = 0;
    const actualizada = await vlanService.aplicar(router, vlan, 'actualizar');
    assert.strictEqual(actualizada.ok, true, `VLAN actualizar: ${actualizada.salida}`);
    assert.ok(COMANDOS.some((c) => c === 'ip address 192.0.2.1 255.255.255.0'), 'actualizar reaplica la dirección');
    assert.ok(!COMANDOS.includes('shutdown'), 'actualizar no debe apagar la VLAN');

    assert.strictEqual(
      planService.routerPermitido({ trafficMode: 'simple_queue' }, { vendor: 'cisco', planMode: 'simple_queue' }),
      false,
      'Cisco no debe aceptar planes de servicio'
    );
    assert.strictEqual(
      planService.routerPermitido({ trafficMode: 'simple_queue' }, { vendor: 'mikrotik', planMode: 'simple_queue' }),
      true
    );

    const balance = await balanceService.aplicar(
      router,
      { _id: new ObjectId(), entries: [{ gateway: '192.0.2.1' }, { gateway: '192.0.2.2' }] },
      'crear',
      { anteriores: [] }
    );
    assert.strictEqual(balance.ok, true, `Balanceo: ${balance.salida}`);
    assert.ok(COMANDOS.some((c) => c === 'ip route 0.0.0.0 0.0.0.0 192.0.2.1'));

    assert.throws(() => vlanService.validarVlan({ vlanId: 20, name: 'VLAN\nreload', interface: 'Gi0/1' }), /control|salto/i);
    assert.ok(!COMANDOS.includes('reload'), 'el nombre no debe inyectar comandos');

    console.log('OK  Cisco: version, respaldo, VLAN, balanceo y rechazo de inyeccion.');
  } finally {
    await sim.detener();
    await mongoose.connection.db.dropDatabase().catch(() => null);
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await sim.detener().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});

