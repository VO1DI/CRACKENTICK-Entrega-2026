/* Prueba de humo: comprueba que la app responde y que IPAM no ofrece IPs usadas.
   Requiere el servidor corriendo y MongoDB iniciado.
   Uso: node pruebas/probar-humo.js
*/
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const BASE = process.env.APP_URL || 'http://localhost:3000';
const USUARIO = process.env.APP_USER || 'admin';
const CLAVE = process.env.APP_PASS || 'admin123';

const resultados = [];
const ok = (nombre, detalle = '') => resultados.push({ ok: true, nombre, detalle });
const falla = (nombre, detalle = '') => resultados.push({ ok: false, nombre, detalle });
const exigir = (condicion, mensaje) => {
  if (!condicion) throw new Error(mensaje);
};

async function pagina(ruta, texto, cookie = '') {
  try {
    const respuesta = await fetch(`${BASE}${ruta}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    const cuerpo = await respuesta.text();
    exigir(respuesta.status === 200, `respondio ${respuesta.status}`);
    exigir(cuerpo.includes(texto), `no contiene "${texto}"`);
    ok(ruta);
  } catch (error) {
    falla(ruta, error.message);
  }
}

(async () => {
  console.log(`Probando ${BASE}\n`);

  let cookie = '';
  try {
    const previa = await fetch(`${BASE}/login`);
    const html = await previa.text();
    const token = (html.match(/name="csrf-token" content="([^"]+)"/) || [])[1] || '';
    const cookiePrevio = (previa.headers.getSetCookie?.() || [previa.headers.get('set-cookie')])
      .filter(Boolean).map((c) => c.split(';')[0]).join('; ');
    const respuesta = await fetch(`${BASE}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookiePrevio },
      body: new URLSearchParams({ usuario: USUARIO, password: CLAVE, _csrf: token }).toString(),
    });
    const crudo = respuesta.headers.get('set-cookie') || '';
    cookie = crudo.split(';')[0];
    exigir(respuesta.status === 302, `login respondio ${respuesta.status}`);
    exigir(cookie.includes('='), 'sin cookie de sesion');
    ok('Inicio de sesion', USUARIO);
  } catch (error) {
    falla('Inicio de sesion', `${error.message}. Verifica que el servidor este corriendo.`);
    console.log('No se puede continuar sin sesion.');
    imprimir();
    process.exit(1);
  }

  await pagina('/portal/login', 'Portal');
  await pagina('/', 'CRACKENTICK', cookie);
  await pagina('/red/ipam', 'IPAM', cookie);
  await pagina('/hotspot', 'Hotspot', cookie);
  await pagina('/hotspot/planes', 'Planes de hotspot', cookie);
  await pagina('/red/consumo', 'Consumo diario', cookie);
  await pagina('/red/respaldos', 'Respaldo', cookie);
  await pagina('/red/monitoreo/configuracion', 'Configuración del monitoreo', cookie);
  await pagina('/agenda', 'Agenda', cookie);
  await pagina('/reportes', 'Reporte', cookie);
  await pagina('/clientes', 'Cliente', cookie);
  await pagina('/ventas/nueva', 'Venta', cookie);

  try {
    const IpPool = require('../models/IpPool');
    const Subscription = require('../models/Subscription');
    const Sale = require('../models/Sale');
    require('../models/Router');
    require('../models/Client');
    const { contarIps, ipEnCidr } = require('../utils/ip');

    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    const pools = await IpPool.find({}).lean();
    exigir(pools.length > 0, 'no hay pools de IP');

    const pool = pools.find((fila) => contarIps(fila.cidr) <= 2048) || pools[0];
    const claves = [{ 'serviceConfig.ipPoolId': pool._id }];
    if (pool.routerId) claves.push({ 'serviceConfig.routerId': pool.routerId });
    const [servicios, ventas] = await Promise.all([
      Subscription.find({ $or: claves, 'serviceConfig.ipAddress': { $nin: ['', null] } })
        .select('serviceConfig.ipAddress')
        .lean(),
      Sale.find({ status: 'waiting', 'service.ipAddress': { $nin: ['', null] } })
        .select('service.ipAddress')
        .lean(),
    ]);
    const usadas = new Set([
      ...servicios.map((fila) => fila.serviceConfig.ipAddress),
      ...ventas.map((fila) => fila.service.ipAddress),
    ].filter(Boolean));
    const usadasEnPool = [...usadas].filter((ip) => ipEnCidr(ip, pool.cidr));

    const respuesta = await fetch(`${BASE}/clientes/api/pools/${pool._id}/ips`, {
      headers: { cookie, Accept: 'application/json' },
    });
    const datos = await respuesta.json();
    exigir(datos.ok === true, 'la API no respondio ok');
    exigir(datos.pool.total === contarIps(pool.cidr), 'total del pool no coincide');
    exigir(
      datos.pool.disponibles === datos.pool.total - usadasEnPool.length,
      `disponibles ${datos.pool.disponibles} != total ${datos.pool.total} - usadas ${usadasEnPool.length}`
    );
    const coladas = datos.ips.filter((ip) => usadas.has(ip));
    exigir(coladas.length === 0, `la lista incluye IPs usadas: ${coladas.join(', ')}`);
    exigir(
      datos.ips.length === Math.min(datos.pool.disponibles, 512),
      `la lista trae ${datos.ips.length} y se esperaban ${Math.min(datos.pool.disponibles, 512)}`
    );
    ok('IPAM sin IPs usadas', `${pool.name}: ${datos.pool.disponibles} libres de ${datos.pool.total}`);

    const indices = await mongoose.connection.db.collection('trafficdailies').indexes();
    const ttl = indices.find((indice) => indice.key.date === 1 && indice.expireAfterSeconds === 7776000);
    exigir(ttl, 'falta el indice TTL de 90 dias en trafficdailies');
    ok('Retencion de consumo', 'TTL 90 dias');
  } catch (error) {
    falla('IPAM / retencion', error.message);
  } finally {
    await mongoose.disconnect().catch(() => null);
  }

  imprimir();
  process.exit(resultados.some((fila) => !fila.ok) ? 1 : 0);
})();

function imprimir() {
  console.log('');
  for (const fila of resultados) {
    console.log(`${fila.ok ? 'OK   ' : 'FALLA'} ${fila.nombre}${fila.detalle ? ` -> ${fila.detalle}` : ''}`);
  }
  const fallos = resultados.filter((fila) => !fila.ok).length;
  console.log('');
  console.log(fallos ? `${fallos} prueba(s) fallaron.` : `${resultados.length} comprobaciones correctas.`);
}
