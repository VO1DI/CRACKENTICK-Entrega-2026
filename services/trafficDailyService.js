const TrafficDaily = require('../models/TrafficDaily');
const Router = require('../models/Router');
const Subscription = require('../models/Subscription');
const routeros = require('./routeros');

const ultimos = new Map();
let iniciado = false;

function inicioDia(fecha = new Date()) {
  const dia = new Date(fecha);
  dia.setHours(0, 0, 0, 0);
  return dia;
}

/** RouterOS devuelve los contadores como "rx/tx" o un total. */
function leerBytes(valor) {
  const texto = String(valor || '').trim();
  const partes = texto.split('/');
  if (partes.length === 2) {
    const rx = Number(String(partes[0]).replace(/[^0-9.]/g, '')) || 0;
    const tx = Number(String(partes[1]).replace(/[^0-9.]/g, '')) || 0;
    return { rx, tx };
  }
  const total = Number(texto.replace(/[^0-9.]/g, '')) || 0;
  return { rx: total, tx: 0 };
}

/**
 * Lee los contadores de las colas de cada router y guarda el delta del día.
 * La primera lectura solo establece la base; no cuenta el acumulado histórico.
 */
async function recolectarBase() {
  const routers = await Router.find({ active: true, vendor: 'mikrotik', mode: 'real' });
  if (!routers.length) return { routers: 0, filas: 0 };

  const ids = routers.map((router) => router._id);
  const subs = await Subscription.find({
    status: { $ne: 'cancelled' },
    'serviceConfig.routerId': { $in: ids },
    'serviceConfig.queueName': { $ne: '' },
  })
    .select('clientId serviceConfig')
    .lean();

  const porRouter = new Map();
  const vistos = new Set(subs.map((sub) => String(sub._id)));
  for (const sub of subs) {
    const llave = String(sub.serviceConfig.routerId);
    if (!porRouter.has(llave)) porRouter.set(llave, []);
    porRouter.get(llave).push(sub);
  }

  const dia = inicioDia();
  let filas = 0;

  for (const router of routers) {
    const lista = porRouter.get(String(router._id)) || [];
    if (!lista.length) continue;
    let conexion;
    try {
      conexion = await routeros.conectar(router);
    } catch (error) {
      continue;
    }
    try {
      const colas = await conexion.write('/queue/simple/print');
      for (const sub of lista) {
        const nombre = sub.serviceConfig.queueName || `ct-${sub.serviceConfig.pppoeUsername}`;
        const cola = colas.find((fila) => fila.name === nombre);
        if (!cola) continue;
        const { rx, tx } = leerBytes(cola.bytes);
        const llave = String(sub._id);
        vistos.add(llave);
        const anterior = ultimos.get(llave);
        ultimos.set(llave, { rx, tx });
        if (!anterior) continue;
        const deltaRx = Math.max(0, rx - anterior.rx);
        const deltaTx = Math.max(0, tx - anterior.tx);
        if (!deltaRx && !deltaTx) continue;
        await TrafficDaily.updateOne(
          { subscriptionId: sub._id, date: dia },
          {
            $inc: { rxBytes: deltaRx, txBytes: deltaTx, samples: 1 },
            $set: { clientId: sub.clientId, routerId: router._id, queueName: cola.name },
          },
          { upsert: true }
        );
        filas += 1;
      }
    } catch (error) {
      /* un router caído no debe detener a los demás */
    } finally {
      routeros.cerrar(conexion);
    }
  }

  for (const llave of ultimos.keys()) {
    if (!vistos.has(llave)) ultimos.delete(llave);
  }

  return { routers: routers.length, filas };
}

let enCurso = false;

async function recolectar() {
  if (enCurso) return { routers: 0, filas: 0, omitido: true };
  enCurso = true;
  try {
    return await recolectarBase();
  } finally {
    enCurso = false;
  }
}

/** Arranca el recolector: primera base al minuto y luego cada 15 minutos. */
function iniciar() {
  if (iniciado) return;
  iniciado = true;
  const inicial = setTimeout(() => recolectar().catch(() => null), 60 * 1000);
  if (inicial.unref) inicial.unref();
  const temporizador = setInterval(() => {
    recolectar().catch((error) => console.error('Consumo diario:', error.message));
  }, 15 * 60 * 1000);
  temporizador.unref();
}

/** Filas cliente-día en el rango, con el cliente poblado. */
async function detalle({ desde, hasta, routerId, clientId }) {
  const filtro = { date: { $gte: desde, $lte: hasta } };
  if (routerId) filtro.routerId = routerId;
  if (clientId) filtro.clientId = clientId;
  return TrafficDaily.find(filtro)
    .populate('clientId', 'clientCode firstName lastName')
    .sort({ date: 1 })
    .lean();
}

module.exports = { recolectar, iniciar, detalle, inicioDia, leerBytes };
