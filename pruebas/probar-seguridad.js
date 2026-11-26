/**
 * Regresiones de seguridad y permisos, sin servidor ni base real.
 * Uso: node pruebas/probar-seguridad.js
 */
const assert = require('assert');
const { rutaInterna } = require('../utils/strings');
const { crearLimite } = require('../utils/rateLimit');
const { validarVlan } = require('../services/vlanService');
const { puedeAlerta, tiposPermitidos } = require('../controllers/notificationController');
const { construir, ocultarSecretos } = require('../services/mikrotikCli');
const { cifrarBuffer, descifrarBuffer } = require('../services/cryptoService');

/* 7. Redirección abierta. */
assert.strictEqual(rutaInterna('//evil.example', '/seguro'), '/seguro');
assert.strictEqual(rutaInterna('/clientes', '/seguro'), '/clientes');
assert.strictEqual(rutaInterna('/a\\b', '/seguro'), '/seguro');
assert.strictEqual(rutaInterna('/a\nb', '/seguro'), '/seguro');
assert.strictEqual(rutaInterna('https://evil.example', '/seguro'), '/seguro');

/* 6. Inyección en el nombre de VLAN. */
assert.throws(() => validarVlan({ vlanId: 10, name: 'VLAN\nreload', interface: 'ether1' }), /control|salto/i);
assert.throws(() => validarVlan({ vlanId: 10, name: 'VLAN\tX', interface: 'ether1' }), /control|salto/i);
assert.strictEqual(validarVlan({ vlanId: 10, name: 'VLAN Ventas', interface: 'ether1' }).nombre, 'VLAN Ventas');

/* 6b. El modo SSH de RouterOS escapa comillas, barras y $. */
const comandoSsh = construir({
  path: '/ip/firewall/address-list/add',
  lookup: { path: '/ip/firewall/address-list/print', filters: ['?list=CLIENTES'] },
  params: ['=comment=a"b$c\\d', '=address=10.0.0.1/24'],
});
assert.ok(comandoSsh.includes('a\\"b\\$c\\\\d'), 'debe escapar comillas, $ y barra');
assert.ok(comandoSsh.includes('address="10.0.0.1/24"'), 'debe citar valores con /');
const comandoSalto = construir({ path: '/ppp/secret/add', params: ['=name=x\n/system reboot'] });
assert.ok(!/[\r\n]/.test(comandoSalto), 'un salto de línea no debe llegar a la consola SSH');
const comandoClave = construir({ path: '/ppp/secret/add', params: ['=name=x', '=password=Secreta123'] });
assert.ok(!ocultarSecretos(comandoClave).includes('Secreta123'), 'la clave PPPoE no debe quedar en el resultado SSH');
assert.ok(ocultarSecretos(comandoClave).includes('******'), 'la clave debe enmascararse');

/* 12. Límite de intentos acotado. */
const limite = crearLimite({ max: 2, maxClaves: 3 });
for (let i = 0; i < 10; i += 1) limite.anotar(`usuario-${i}`, false);
assert.ok(limite.tamano() <= 3, 'el mapa de intentos debe quedar acotado');

/* 12b. La ráfaga en paralelo reserva el intento antes de validar la clave. */
const reserva = crearLimite({ max: 2 });
assert.ok(reserva.permitido('misma-ip:admin'));
assert.ok(reserva.permitido('misma-ip:admin'));
assert.strictEqual(reserva.permitido('misma-ip:admin'), false, 'el tercer intento paralelo debe bloquearse');
reserva.anotar('misma-ip:admin', true);
assert.ok(reserva.permitido('misma-ip:admin'), 'un login correcto limpia el contador');

/* 8. Solo lectura no puede gestionar alertas. */
const lectura = { role: 'staff', permissions: ['red.monitoreo:read'] };
const edicion = { role: 'staff', permissions: ['red.monitoreo'] };
assert.strictEqual(puedeAlerta(lectura, { type: 'wan_down' }, false), true);
assert.strictEqual(puedeAlerta(lectura, { type: 'wan_down' }, true), false);
assert.strictEqual(puedeAlerta(edicion, { type: 'wan_down' }, true), true);
assert.strictEqual(tiposPermitidos(lectura, true).length, 0);
assert.ok(tiposPermitidos(edicion, true).includes('wan_down'));

/* 13. El respaldo binario se cifra y conserva los bytes originales. */
const binarioOriginal = Buffer.from('contenido binario del respaldo');
const binarioCifrado = cifrarBuffer(binarioOriginal);
assert.strictEqual(binarioCifrado.subarray(0, 4).toString(), 'CTB1');
assert.deepStrictEqual(descifrarBuffer(binarioCifrado), binarioOriginal);
assert.deepStrictEqual(descifrarBuffer(Buffer.from('respaldo legado')), Buffer.from('respaldo legado'));

console.log('OK  Seguridad: redirección, VLAN, límite de intentos, respaldos cifrados y permisos de alertas.');
process.exit(0);
