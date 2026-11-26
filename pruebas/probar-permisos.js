/**
 * Matriz de permisos por ruta: recorre cada router montado y comprueba que
 * un usuario solo-lectura no puede ejecutar ningún POST y que un usuario sin
 * permisos no ve ningún nodo. También valida el filtrado de alertas.
 *
 * Requiere la app corriendo en http://localhost:3000 y MongoDB local.
 * Uso: node pruebas/probar-permisos.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const User = require('../models/User');
const Alert = require('../models/Alert');
const { PERMISOS } = require('../config/constants');

const BASE = process.env.APP_URL || 'http://localhost:3000';
const ID_FALSO = '000000000000000000000000';

const MONTAJES = [
  ['', 'index'],
  ['/notificaciones', 'notifications'],
  ['/asistente', 'assistant'],
  ['/clientes', 'clients'],
  ['/suscripciones', 'subscriptions'],
  ['/red/routers', 'routers'],
  ['/red/pools', 'pools'],
  ['/red/planes', 'plans'],
  ['/red/monitoreo', 'monitoring'],
  ['/red/zonas', 'zones'],
  ['/red/vlans', 'vlans'],
  ['/red/dhcp', 'dhcpServers'],
  ['/red/firewall', 'firewallRules'],
  ['/red/eoip', 'eoip'],
  ['/red/balanceo', 'balance'],
  ['/red/respaldos', 'backups'],
  ['/reportes', 'reports'],
  ['/red/reportes/averias', 'faultReports'],
  ['/red/reportes/instalaciones', 'installationReports'],
  ['/ventas/inventario', 'inventory'],
  ['/ventas', 'sales'],
  ['/soporte/tickets', 'tickets'],
  ['/agenda', 'agenda'],
  ['/red/consumo', 'consumption'],
  ['/red/ipam', 'ipam'],
  ['/hotspot', 'hotspot'],
  ['/finanzas/facturacion', 'billing'],
  ['/finanzas/facturas', 'invoices'],
  ['/finanzas', 'finance'],
  ['/admin/usuarios', 'users'],
  ['/admin/empleados', 'employees'],
  ['/admin/gastos', 'expenses'],
  ['/admin/configuracion', 'settings'],
  ['/admin/auditoria', 'audit'],
  ['/planes', 'plans'],
  ['/routers', 'routers'],
  ['/pools', 'pools'],
  ['/monitoreo', 'monitoring'],
  ['/inventario', 'inventory'],
  ['/tickets', 'tickets'],
  ['/facturacion', 'billing'],
  ['/facturas', 'invoices'],
  ['/configuracion', 'settings'],
  ['/logs', 'audit'],
];

/** GET que llaman a servicios externos (rclone o un proveedor de IA). */
function omitir(ruta) {
  return ruta.endsWith('/ia/modelos') || ruta.endsWith('/respaldos/sistema/estado');
}

function rutas() {
  const casos = [];
  for (const [prefijo, archivo] of MONTAJES) {
    delete require.cache[require.resolve(`../routes/${archivo}`)];
    const router = require(`../routes/${archivo}`);
    for (const capa of router.stack) {
      if (!capa.route) continue;
      const metodos = Object.keys(capa.route.methods).filter((m) => m === 'get' || m === 'post');
      for (const metodo of metodos) {
        let ruta = `${prefijo}${capa.route.path}`.replace(/\/{2,}/g, '/');
        ruta = ruta.replace(/:[^/]+/g, ID_FALSO);
        if (ruta.length > 1) ruta = ruta.replace(/\/$/, '');
        casos.push({ metodo: metodo.toUpperCase(), ruta });
      }
    }
  }
  return casos;
}

async function login(usuario, password) {
  const previa = await fetch(`${BASE}/login`);
  const html = await previa.text();
  const token = (html.match(/name="csrf-token" content="([^"]+)"/) || [])[1] || '';
  const cookiePrevio = (previa.headers.getSetCookie?.() || [previa.headers.get('set-cookie')])
    .filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookiePrevio },
    body: new URLSearchParams({ usuario, password, _csrf: token }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  assert.strictEqual(res.status, 302, `login de ${usuario} debe redirigir`);
  const galletas = res.headers.getSetCookie?.() || [res.headers.get('set-cookie')];
  const sesion = galletas.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  assert.ok(sesion, `login de ${usuario} debe devolver cookie`);
  return sesion;
}

async function pedir(metodo, ruta, cookie) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: metodo === 'POST' ? '' : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  return res.status;
}

async function crearUsuario(username, permissions) {
  await User.deleteOne({ username });
  const usuario = new User({ name: 'Auditoría Permisos', username, role: 'staff', active: true, permissions });
  usuario.establecerPassword('auditoria123');
  await usuario.save();
  return usuario;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const lector = await crearUsuario('auditor-lector', PERMISOS.map((k) => `${k}:read`));
  const sinAcceso = await crearUsuario('auditor-sin-acceso', []);
  const soloRed = await crearUsuario('auditor-solo-red', ['red.monitoreo:read']);

  const cookieLector = await login('auditor-lector', 'auditoria123');
  const cookieSin = await login('auditor-sin-acceso', 'auditoria123');
  const cookieRed = await login('auditor-solo-red', 'auditoria123');

  const casos = rutas();
  const fallos = [];

  // 1) Solo lectura: todos los GET permitidos, ningún POST.
  for (const caso of casos) {
    if (omitir(caso.ruta)) continue;
    const estado = await pedir(caso.metodo, caso.ruta, cookieLector);
    if (caso.metodo === 'GET') {
      if (estado === 403 || estado >= 500) fallos.push(`lector GET ${caso.ruta} -> ${estado}`);
    } else if (![403, 302, 401].includes(estado)) {
      fallos.push(`lector POST ${caso.ruta} -> ${estado} (debía bloquearse)`);
    }
  }

  // 2) Sin permisos: ningún nodo visible, ningún POST ejecutable.
  for (const caso of casos) {
    if (omitir(caso.ruta)) continue;
    const estado = await pedir(caso.metodo, caso.ruta, cookieSin);
    if (caso.metodo === 'GET') {
      const excepcion = caso.ruta.startsWith('/notificaciones') && estado === 200;
      if (!excepcion && estado !== 403 && estado !== 302) {
        fallos.push(`sin acceso GET ${caso.ruta} -> ${estado} (debía ser 403)`);
      }
    } else if (![403, 302, 401].includes(estado)) {
      fallos.push(`sin acceso POST ${caso.ruta} -> ${estado} (debía bloquearse)`);
    }
  }

  // 3) Aislamiento entre nodos: solo Red puede entrar a Red.
  assert.strictEqual(await pedir('GET', '/red/monitoreo', cookieRed), 200);
  assert.strictEqual(await pedir('GET', '/clientes', cookieRed), 403);
  assert.strictEqual(await pedir('POST', '/red/monitoreo/configuracion', cookieRed), 403);

  // 4) Alertas: el lector de Red no resuelve ni las de Red ni las de stock.
  const avisoRed = await Alert.create({
    routerId: null,
    routerName: 'Prueba',
    wan: 'wan1',
    type: 'wan_down',
    severity: 'critical',
    message: 'Aviso de red de prueba',
    value: 'sin servicio',
    status: 'active',
  });
  const avisoStock = await Alert.create({
    routerId: null,
    routerName: '',
    wan: '',
    type: 'stock_low',
    severity: 'warning',
    message: 'Aviso de stock de prueba',
    value: '0',
    status: 'active',
  });

  await pedir('POST', '/notificaciones/resolver-todas', cookieRed);
  await pedir('POST', `/notificaciones/alertas/${avisoRed._id}/resolver`, cookieRed);
  assert.strictEqual((await Alert.findById(avisoRed._id)).status, 'active', 'el lector no debe resolver alertas de red');
  assert.strictEqual((await Alert.findById(avisoStock._id)).status, 'active', 'el lector no debe tocar stock');

  const pagina = await fetch(`${BASE}/notificaciones`, { headers: { Cookie: cookieRed } });
  const html = await pagina.text();
  assert.ok(html.includes('Aviso de red de prueba'), 'el lector de Red debe ver la alerta de Red');
  assert.ok(!html.includes('Aviso de stock de prueba'), 'el lector de Red no debe ver stock');
  assert.strictEqual(await pedir('GET', '/notificaciones', cookieSin), 200);

  // Limpieza
  await Alert.deleteMany({ _id: { $in: [avisoRed._id, avisoStock._id] } });
  await User.deleteMany({ _id: { $in: [lector._id, sinAcceso._id, soloRed._id] } });
  await mongoose.disconnect();

  if (fallos.length) {
    console.error('FALLOS DE PERMISOS:');
    fallos.forEach((fallo) => console.error(`  ${fallo}`));
    process.exit(1);
  }
  console.log(`OK  Permisos: ${casos.filter((c) => c.metodo === 'GET').length} GET y ${casos.filter((c) => c.metodo === 'POST').length} POST revisados; aislamiento y alertas correctos.`);
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await User.deleteMany({ username: /^auditor-/ }).catch(() => null);
  await Alert.deleteMany({ message: /de prueba$/ }).catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
