const Router = require('../models/Router');
const Alert = require('../models/Alert');
const routerService = require('./routerService');
const { registrar } = require('./auditService');
const notifyService = require('./notifyService');
const alertBadgeCache = require('./alertBadgeCache');
const settingsCache = require('./settingsCache');
const icmpService = require('./icmpService');

const MAX_MUESTRAS = 60;
const INTERVALO_MS = 5000;
const TTL_CLIENTE_MS = 60000;
const CONFIG_DEFECTO = { intervalMs: INTERVALO_MS, downDelayMs: 0, icmpEnabled: false, icmpTimeoutMs: 2000 };

const serieWan = new Map(); // `${routerId}:${wan}` → { muestras, status, alertId }
const sesionesCliente = new Map(); // subscriptionId → { startedAt, lastSeen, muestras, subscription }
let temporizador = null;
let temporizadorLimpieza = null;

const serieRouter = new Map(); // routerId -> { status, downSince, alertId, host }

/** Configuración vigente de monitorización. */
async function configuracion() {
  try {
    const settings = await settingsCache.obtener();
    const m = settings?.monitoring || {};
    return {
      intervalMs: Math.max(2000, Number(m.intervalMs) || INTERVALO_MS),
      downDelayMs: Math.max(0, Number(m.downDelayMs) || 0),
      icmpEnabled: m.icmpEnabled === true,
      icmpTimeoutMs: Math.max(500, Number(m.icmpTimeoutMs) || 2000),
    };
  } catch (error) {
    return { ...CONFIG_DEFECTO };
  }
}

function clave(routerId, wan) {
  return `${String(routerId)}:${wan}`;
}

function agregarMuestra(estado, rx, tx) {
  estado.muestras.push({ t: Date.now(), rx: Math.round(rx), tx: Math.round(tx) });
  if (estado.muestras.length > MAX_MUESTRAS) estado.muestras.shift();
}

async function registrarAlerta(router, wan, { type, severity, message, value }) {
  /* Tras un reinicio la serie en memoria se pierde: si la caída sigue activa,
     se reutiliza el aviso existente en lugar de duplicarlo. */
  if (type === 'wan_down' || type === 'router_down') {
    const existente = await Alert.findOne({
      routerId: router._id,
      wan: wan.name || '',
      type,
      status: { $in: ['active', 'acknowledged'] },
    }).sort({ startedAt: -1 });
    if (existente) return existente;
  }

  const alerta = await Alert.create({
    routerId: router._id,
    routerName: router.name,
    wan: wan.name,
    type,
    severity,
    message,
    value,
    status: type === 'wan_up' ? 'resolved' : 'active',
    startedAt: new Date(),
    resolvedAt: type === 'wan_up' ? new Date() : undefined,
  });
  await registrar({
    module: 'monitoring',
    entity: 'Alert',
    entityId: alerta._id,
    action: 'alert',
    description: message,
    changes: { after: { router: router.name, wan: wan.name, type, severity } },
    status: type === 'wan_down' ? 'failed' : 'success',
    actor: 'system',
  });
  notifyService.notificarAlerta(alerta);
  alertBadgeCache.invalidar();
  return alerta;
}

async function resolverAlertaActiva(router, wan) {
  const activa = await Alert.findOne({
    routerId: router._id,
    wan: wan.name,
    status: { $in: ['active', 'acknowledged'] },
  }).sort({ startedAt: -1 });
  if (activa) {
    activa.status = 'resolved';
    activa.resolvedAt = new Date();
    await activa.save();
    alertBadgeCache.invalidar();
  }
  return activa;
}

async function muestrearInterfaz(router, wan, estado, config = CONFIG_DEFECTO) {
  const lectura = await routerService.leerTrafico(router, wan);
  const ahora = Date.now();

  const caida = lectura.status === 'down';

  if (caida) {
    estado.status = 'down';
    if (!estado.downSince) estado.downSince = ahora;
    agregarMuestra(estado, 0, 0);
    if (!estado.alertId && ahora - estado.downSince >= config.downDelayMs) {
      const alerta = await registrarAlerta(router, wan, {
        type: 'wan_down',
        severity: 'critical',
        message: `WAN ${wan.name} de ${router.name} sin servicio${wan.provider ? ` (${wan.provider})` : ''}.`,
        value: lectura.error || 'Sin tráfico',
      });
      estado.alertId = String(alerta._id);
    }
    return;
  }

  if (estado.status === 'down') {
    if (estado.alertId) {
      await resolverAlertaActiva(router, wan);
      await registrarAlerta(router, wan, {
      type: 'wan_up',
      severity: 'info',
      message: `WAN ${wan.name} de ${router.name} restablecida.`,
      value: 'En línea',
      });
    }
    estado.alertId = null;
    estado.downSince = 0;
  }

  estado.status = 'up';
  agregarMuestra(estado, lectura.rx, lectura.tx);
}

async function muestrearRouter(router, config) {
  const key = String(router._id);
  if (!serieRouter.has(key)) {
    serieRouter.set(key, { status: 'unknown', downSince: 0, alertId: null, host: router.host });
  }
  const estado = serieRouter.get(key);
  estado.host = router.host;
  if (!icmpService.hostValido(router.host)) {
    estado.status = 'unknown';
    return;
  }
  const lectura = await icmpService.ping(router.host, config.icmpTimeoutMs);
  const ahora = Date.now();
  if (!lectura.ok) {
    estado.status = 'down';
    if (!estado.downSince) estado.downSince = ahora;
    if (!estado.alertId && ahora - estado.downSince >= config.downDelayMs) {
      const alerta = await registrarAlerta(router, { name: '' }, {
        type: 'router_down',
        severity: 'critical',
        message: `Router ${router.name} no responde a ICMP (${router.host}).`,
        value: lectura.error || 'Sin respuesta',
      });
      estado.alertId = String(alerta._id);
    }
    return;
  }

  if (estado.status === 'down') {
    if (estado.alertId) {
      await resolverAlertaActiva(router, { name: '' });
      await registrarAlerta(router, { name: '' }, {
        type: 'router_up',
        severity: 'info',
        message: `Router ${router.name} responde de nuevo (${lectura.ms} ms).`,
        value: `${lectura.ms} ms`,
      });
    }
    estado.alertId = null;
    estado.downSince = 0;
  }
  estado.status = 'up';
  estado.ms = lectura.ms;
}

/** Toma una muestra de todas las WAN activas y actualiza alertas. */
async function procesarWan(router, wan, config) {
  const k = clave(router._id, wan.name);
  if (!serieWan.has(k)) {
    serieWan.set(k, { muestras: [], status: 'up', downSince: 0, alertId: null });
  }
  try {
    await muestrearInterfaz(router, wan, serieWan.get(k), config);
  } catch (error) {
    const estado = serieWan.get(k);
    estado.status = 'down';
    if (!estado.downSince) estado.downSince = Date.now();
    agregarMuestra(estado, 0, 0);
    if (!estado.alertId && Date.now() - estado.downSince >= config.downDelayMs) {
      const alerta = await registrarAlerta(router, wan, {
        type: 'wan_down',
        severity: 'critical',
        message: `WAN ${wan.name} de ${router.name} sin servicio: ${error.message}`,
        value: 'Error de lectura',
      });
      estado.alertId = String(alerta._id);
    }
  }
}

/** Una pasada completa; se usa para pruebas o diagnóstico manual. */
async function muestrear() {
  const config = await configuracion();
  const routers = await Router.find({ active: true }).select('+passwordEnc').lean();
  const vistos = new Set();
  await Promise.all(
    routers.flatMap((router) =>
      (router.wanInterfaces || []).map((wan) => {
        vistos.add(clave(router._id, wan.name));
        return procesarWan(router, wan, config);
      })
    )
  );

  for (const k of serieWan.keys()) {
    if (!vistos.has(k)) serieWan.delete(k);
  }
}

/** Snapshot listo para la vista y para el endpoint JSON. */
async function estadoWan() {
  // No muestrear aquí: el intervalo de 5 s ya lo hace. Las peticiones solo leen la serie.
  const routers = await Router.find({ active: true }).sort({ createdAt: 1 }).lean();
  const alertas = await Alert.find({ status: { $in: ['active', 'acknowledged'] } }).sort({ startedAt: -1 }).lean();
  const mapaAlertas = new Map(alertas.map((a) => [`${String(a.routerId)}:${a.wan}`, a]));

  return routers.flatMap((router) =>
    (router.wanInterfaces || []).map((wan) => {
      const estado = serieWan.get(clave(router._id, wan.name)) || { muestras: [], status: 'up' };
      const ultima = estado.muestras[estado.muestras.length - 1] || { rx: 0, tx: 0 };
      return {
        routerId: String(router._id),
        router: router.name,
        modo: router.mode,
        wan: wan.name,
        proveedor: wan.provider || '',
        downloadMbps: wan.downloadMbps,
        uploadMbps: wan.uploadMbps,
        status: estado.status,
        rx: ultima.rx,
        tx: ultima.tx,
        muestras: estado.muestras.slice(-40),
        alerta: mapaAlertas.get(`${String(router._id)}:${wan.name}`) || null,
      };
    })
  );
}

/** Estado ICMP de routers para la vista. */
async function estadoRouters(routers = null) {
  const lista = routers || (await Router.find({ active: true }).sort({ name: 1 }).lean());
  return lista.map((router) => {
    const estado = serieRouter.get(String(router._id));
    return {
      id: String(router._id),
      name: router.name,
      host: router.host || '',
      status: estado?.status || 'unknown',
      ms: estado?.ms || null,
    };
  });
}

/* -------------------------------------------------------------------------
   Monitorización puntual por cliente
   ------------------------------------------------------------------------- */

async function muestraCliente(sesion) {
  const subscription = sesion.subscription;
  const config = subscription.serviceConfig || {};
  const plan = subscription.planSnapshot || {};
  const maxRx = (Number(plan.downloadSpeed) || 100) * 1e6;
  const maxTx = (Number(plan.uploadSpeed) || 50) * 1e6;

  let lectura = null;
  try {
    lectura = await routerService.leerTraficoCliente(subscription);
  } catch (error) {
    lectura = { ok: false, error: error.message };
  }

  let rx;
  let tx;
  let status;
  let modo;
  let origen = '';

  if (lectura === null) {
    // Router en modo simulado: caminata aleatoria alrededor del plan.
    const activo = Math.random() > 0.06;
    rx = activo ? maxRx * (0.08 + Math.random() * 0.72) : 0;
    tx = activo ? maxTx * (0.05 + Math.random() * 0.6) : 0;
    status = activo ? 'up' : 'idle';
    modo = 'simulado';
  } else if (lectura.ok) {
    rx = Number(lectura.rx) || 0;
    tx = Number(lectura.tx) || 0;
    status = lectura.status || (rx + tx > 0 ? 'up' : 'idle');
    modo = 'real';
    origen = lectura.origen || '';
  } else {
    rx = 0;
    tx = 0;
    status = 'down';
    modo = 'real';
    origen = lectura.origen || '';
    sesion.error = lectura.error || 'No se pudo leer el tráfico del cliente.';
  }

  sesion.modo = modo;
  sesion.origen = origen;
  sesion.link = config.connectionType === 'pppoe' ? config.pppoeUsername || '' : config.ipAddress || '';
  sesion.muestras.push({ t: Date.now(), rx: Math.round(rx), tx: Math.round(tx) });
  if (sesion.muestras.length > MAX_MUESTRAS) sesion.muestras.shift();
  return { rx, tx, status, modo, origen, link: sesion.link, error: sesion.error || null };
}

async function iniciarCliente(subscription) {
  const id = String(subscription._id);
  const sesion = {
    startedAt: Date.now(),
    lastSeen: Date.now(),
    muestras: [],
    subscription,
    modo: 'simulado',
    origen: '',
    link: '',
    error: null,
  };
  sesionesCliente.set(id, sesion);
  const actual = await muestraCliente(sesion);
  return { ...actual, muestras: sesion.muestras, startedAt: sesion.startedAt };
}

async function leerCliente(subscriptionId) {
  const id = String(subscriptionId);
  const sesion = sesionesCliente.get(id);
  if (!sesion) return null;
  if (Date.now() - sesion.lastSeen > TTL_CLIENTE_MS) {
    sesionesCliente.delete(id);
    return null;
  }
  sesion.lastSeen = Date.now();
  const actual = await muestraCliente(sesion);
  return {
    ...actual,
    muestras: sesion.muestras,
    startedAt: sesion.startedAt,
    expiraEnMs: TTL_CLIENTE_MS - (Date.now() - sesion.lastSeen),
  };
}

function detenerCliente(subscriptionId) {
  return sesionesCliente.delete(String(subscriptionId));
}

function limpiarSesiones() {
  const ahora = Date.now();
  for (const [id, sesion] of sesionesCliente) {
    if (ahora - sesion.lastSeen > TTL_CLIENTE_MS) sesionesCliente.delete(id);
  }
}

let arrancado = false;
let detenido = false;
let temporizadorIcmp = null;
let icmpEnCurso = false;
const enVueloWan = new Set();

async function rondaWan() {
  if (detenido) return;
  try {
    const config = await configuracion();
    const routers = await Router.find({ active: true }).select('+passwordEnc').lean();
    const vistos = new Set();
    for (const router of routers) {
      for (const wan of router.wanInterfaces || []) {
        const k = clave(router._id, wan.name);
        vistos.add(k);
        if (enVueloWan.has(k)) continue;
        enVueloWan.add(k);
        procesarWan(router, wan, config)
          .catch(() => null)
          .finally(() => enVueloWan.delete(k));
      }
    }
    for (const k of serieWan.keys()) {
      if (!vistos.has(k) && !enVueloWan.has(k)) serieWan.delete(k);
    }
  } catch (error) {
    console.error('⚠️  Monitorización:', error.message);
  }
  if (detenido) return;
  const { intervalMs } = await configuracion();
  temporizador = setTimeout(rondaWan, intervalMs);
  if (temporizador.unref) temporizador.unref();
}

async function rondaIcmp() {
  if (icmpEnCurso || detenido) return;
  icmpEnCurso = true;
  try {
    const config = await configuracion();
    if (!config.icmpEnabled) {
      serieRouter.clear();
    } else {
      const routers = await Router.find({ active: true }).lean();
      const vistos = new Set();
      await Promise.all(
        routers.map(async (router) => {
          vistos.add(String(router._id));
          try {
            await muestrearRouter(router, config);
          } catch (error) {
            const estado = serieRouter.get(String(router._id));
            if (estado) estado.status = 'down';
          }
        })
      );
      for (const id of serieRouter.keys()) {
        if (!vistos.has(id)) serieRouter.delete(id);
      }
    }
  } catch (error) {
    console.error('⚠️  Monitorización ICMP:', error.message);
  } finally {
    icmpEnCurso = false;
  }
  if (detenido) return;
  const { intervalMs } = await configuracion();
  temporizadorIcmp = setTimeout(rondaIcmp, intervalMs);
  if (temporizadorIcmp.unref) temporizadorIcmp.unref();
}

function iniciar() {
  if (arrancado) return;
  arrancado = true;
  detenido = false;
  rondaWan();
  rondaIcmp();
  temporizadorLimpieza = setInterval(limpiarSesiones, 10000);
  temporizadorLimpieza.unref();
}

function detener() {
  detenido = true;
  arrancado = false;
  if (temporizador) clearTimeout(temporizador);
  if (temporizadorIcmp) clearTimeout(temporizadorIcmp);
  if (temporizadorLimpieza) clearInterval(temporizadorLimpieza);
  temporizador = null;
  temporizadorIcmp = null;
  temporizadorLimpieza = null;
  routerService.cerrarMonitoreo();
}

module.exports = {
  INTERVALO_MS,
  TTL_CLIENTE_MS,
  iniciar,
  detener,
  muestrear,
  configuracion,
  estadoWan,
  estadoRouters,
  iniciarCliente,
  leerCliente,
  detenerCliente,
  limpiarSesiones,
};
