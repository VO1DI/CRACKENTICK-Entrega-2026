const Alert = require('../models/Alert');
const Router = require('../models/Router');
const Subscription = require('../models/Subscription');
const Settings = require('../models/Settings');
const monitoringService = require('../services/monitoringService');
const settingsCache = require('../services/settingsCache');
const alertBadgeCache = require('../services/alertBadgeCache');
const { registrar } = require('../services/auditService');
const { crearError, mensajeDeError } = require('../utils/errors');
const { TIPOS_ALERTA_RED } = require('../config/constants');

/** GET /red/monitoreo */
async function index(req, res, next) {
  try {
    const monitoreoConfig = await monitoringService.configuracion();
    const [wan, alertas, subscriptions, routers] = await Promise.all([
      monitoringService.estadoWan(),
      Alert.find({ status: { $in: ['active', 'acknowledged'] }, type: { $in: TIPOS_ALERTA_RED } }).sort({ startedAt: -1 }).limit(80).lean(),
      Subscription.find({ status: 'active' })
        .populate('clientId')
        .populate('planId')
        .limit(500)
        .lean(),
      Router.find({}).sort({ name: 1 }).lean(),
    ]);

    const filtroRouter = String(req.query.router || '');
    const filtroWan = String(req.query.wan || '');
    /* Mongo ordena el ObjectId, no el nombre poblado: se ordena aquí. */
    subscriptions.sort((a, b) =>
      String(a.clientId?.firstName || '').localeCompare(String(b.clientId?.firstName || ''), 'es')
    );
    const alertasFiltradas =
      filtroRouter || filtroWan
        ? alertas.filter(
            (a) => (!filtroRouter || String(a.routerId) === filtroRouter) && (!filtroWan || a.wan === filtroWan)
          )
        : alertas;

    const proveedores = [];
    wan.forEach((item) => {
      const existente = proveedores.find((p) => p.routerId === item.routerId && p.wan === item.wan);
      if (!existente) {
        proveedores.push({
          routerId: item.routerId,
          wan: item.wan,
          router: item.router,
          proveedor: item.proveedor,
          status: item.status,
        });
      }
    });

    res.render('monitoring/index', {
      titulo: 'Monitorización',
      wan,
      alertas: alertasFiltradas,
      alertasTotal: alertas.length,
      subscriptions,
      routers,
      proveedores,
      filtroRouter,
      filtroWan,
      monitoreoConfig,
      routersMonitoreo: await monitoringService.estadoRouters(routers),
      intervalo: monitoreoConfig.intervalMs,
      tab: 'en-vivo',
    });
  } catch (error) {
    next(error);
  }
}

/** GET /red/monitoreo/api/wan */
async function apiWan(req, res, next) {
  try {
    const wan = await monitoringService.estadoWan();
    const alertas = await Alert.find({ status: { $in: ['active', 'acknowledged'] }, type: { $in: TIPOS_ALERTA_RED } })
      .sort({ startedAt: -1 })
      .limit(40)
      .lean();
    res.json({ ok: true, wan, alertas, ts: Date.now() });
  } catch (error) {
    next(error);
  }
}

/** GET /red/monitoreo/cliente/:id */
async function cliente(req, res, next) {
  try {
    const subscription = await Subscription.findById(req.params.id)
      .populate('clientId')
      .populate('planId')
      .populate('serviceConfig.routerId');
    if (!subscription) throw crearError(404, 'El servicio no existe.');
    res.render('monitoring/client', {
      titulo: `Monitor · ${subscription.clientId?.fullName || 'Cliente'}`,
      subscription,
      ttl: monitoringService.TTL_CLIENTE_MS,
      intervalo: monitoringService.INTERVALO_MS,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /red/monitoreo/api/cliente/:id/iniciar */
async function iniciarCliente(req, res, next) {
  try {
    const subscription = await Subscription.findById(req.params.id)
      .populate('clientId')
      .populate('planId')
      .populate('serviceConfig.routerId');
    if (!subscription) throw crearError(404, 'El servicio no existe.');
    const lectura = await monitoringService.iniciarCliente(subscription);
    res.json({ ok: true, ...lectura, ttl: monitoringService.TTL_CLIENTE_MS });
  } catch (error) {
    next(error);
  }
}

/** GET /red/monitoreo/api/cliente/:id/leer */
async function leerCliente(req, res, next) {
  try {
    const lectura = await monitoringService.leerCliente(req.params.id);
    if (!lectura) {
      return res.status(410).json({ ok: false, expirado: true, mensaje: 'La monitorización expiró por inactividad.' });
    }
    res.json({ ok: true, ...lectura, ttl: monitoringService.TTL_CLIENTE_MS });
  } catch (error) {
    next(error);
  }
}

/** POST /red/monitoreo/api/cliente/:id/detener */
async function detenerCliente(req, res, next) {
  try {
    monitoringService.detenerCliente(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/** GET /red/monitoreo/configuracion */
async function formConfiguracion(req, res, next) {
  try {
    const monitoreoConfig = await monitoringService.configuracion();
    res.render('monitoring/config', {
      titulo: 'Configuración de monitorización',
      monitoreoConfig,
      tab: 'configuracion',
    });
  } catch (error) {
    next(error);
  }
}

/** POST /red/monitoreo/configuracion */
async function guardarConfiguracion(req, res, next) {
  try {
    const intervalSec = Number(req.body.intervalSec);
    const downDelaySec = Number(req.body.downDelaySec);
    const icmpTimeoutMs = Number(req.body.icmpTimeoutMs);
    if (!Number.isInteger(intervalSec) || intervalSec < 2 || intervalSec > 300) {
      throw crearError(422, 'El intervalo debe estar entre 2 y 300 segundos.');
    }
    if (!Number.isInteger(downDelaySec) || downDelaySec < 0 || downDelaySec > 3600) {
      throw crearError(422, 'La espera antes de avisar debe estar entre 0 y 3600 segundos.');
    }
    if (!Number.isInteger(icmpTimeoutMs) || icmpTimeoutMs < 500 || icmpTimeoutMs > 10000) {
      throw crearError(422, 'El timeout ICMP debe estar entre 500 y 10000 ms.');
    }
    const intervalMs = intervalSec * 1000;
    const downDelayMs = downDelaySec * 1000;

    const settings = await Settings.getSingleton();
    if (!settings.monitoring) settings.monitoring = {};
    settings.monitoring.intervalMs = intervalMs;
    settings.monitoring.downDelayMs = downDelayMs;
    settings.monitoring.icmpEnabled = req.body.icmpEnabled === 'on' || req.body.icmpEnabled === 'true';
    settings.monitoring.icmpTimeoutMs = icmpTimeoutMs;
    await settings.save();
    settingsCache.invalidar();

    await registrar({
      module: 'monitoring',
      entity: 'Settings',
      entityId: settings._id,
      action: 'config_change',
      description: `Monitorización: cada ${intervalMs / 1000} s, aviso tras ${downDelayMs / 1000} s, ICMP ${settings.monitoring.icmpEnabled ? 'activo' : 'inactivo'}.`,
      changes: {
        after: {
          intervalMs,
          downDelayMs,
          icmpEnabled: settings.monitoring.icmpEnabled,
          icmpTimeoutMs,
        },
      },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', 'Configuración de monitorización guardada. Se aplica en la siguiente ronda.');
    res.redirect('/red/monitoreo/configuracion');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/monitoreo/configuracion');
    }
    next(error);
  }
}

/** POST /red/monitoreo/interfaces — agrega una WAN a monitorear desde la vista. */
async function crearInterfaz(req, res, next) {
  try {
    const router = await Router.findById(req.body.routerId);
    if (!router) throw crearError(404, 'El router no existe.');
    const nombre = String(req.body.wan || '').trim();
    if (!nombre) throw crearError(422, 'Indica el nombre de la interfaz WAN.');
    if ((router.wanInterfaces || []).some((w) => w.name === nombre)) {
      req.flash('error', `La interfaz ${nombre} ya está registrada en ${router.name}.`);
      return res.redirect('/red/monitoreo');
    }

    router.wanInterfaces.push({
      name: nombre,
      provider: String(req.body.provider || '').trim(),
      downloadMbps: Number(req.body.downloadMbps) || 0,
      uploadMbps: Number(req.body.uploadMbps) || 0,
      notes: String(req.body.notes || '').trim(),
    });
    await router.save();

    await registrar({
      module: 'monitoring',
      entity: 'Router',
      entityId: router._id,
      action: 'update',
      description: `Interfaz WAN ${nombre} agregada a ${router.name} desde Monitorización.`,
      changes: { after: { wan: nombre, provider: req.body.provider || '' } },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', `Interfaz ${nombre} agregada a ${router.name}.`);
    res.redirect('/red/monitoreo');
  } catch (error) {
    req.flash('error', mensajeDeError(error));
    res.redirect('/red/monitoreo');
  }
}

/** POST /red/monitoreo/alertas/:id/reconocer */
async function reconocerAlerta(req, res, next) {
  try {
    const alerta = await Alert.findById(req.params.id);
    if (!alerta) throw crearError(404, 'La alerta no existe.');
    if (!TIPOS_ALERTA_RED.includes(alerta.type)) throw crearError(403, 'Esta alerta no pertenece a la red.');
    alerta.status = 'acknowledged';
    alerta.acknowledgedAt = new Date();
    await alerta.save();
    await registrar({
      module: 'monitoring',
      entity: 'Alert',
      entityId: alerta._id,
      action: 'update',
      description: `Alerta reconocida: ${alerta.message}`,
      changes: { after: { status: alerta.status } },
    });
    req.flash('exito', 'Alerta reconocida.');
    res.redirect('/red/monitoreo');
  } catch (error) {
    next(error);
  }
}

/** POST /red/monitoreo/alertas/:id/resolver */
async function resolverAlerta(req, res, next) {
  try {
    const alerta = await Alert.findById(req.params.id);
    if (!alerta) throw crearError(404, 'La alerta no existe.');
    if (!TIPOS_ALERTA_RED.includes(alerta.type)) throw crearError(403, 'Esta alerta no pertenece a la red.');
    alerta.status = 'resolved';
    alerta.resolvedAt = new Date();
    await alerta.save();
    alertBadgeCache.invalidar();
    await registrar({
      module: 'monitoring',
      entity: 'Alert',
      entityId: alerta._id,
      action: 'update',
      description: `Alerta resuelta manualmente: ${alerta.message}`,
      changes: { after: { status: alerta.status } },
    });
    req.flash('exito', 'Alerta marcada como resuelta.');
    res.redirect('/red/monitoreo');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  index,
  apiWan,
  cliente,
  iniciarCliente,
  leerCliente,
  detenerCliente,
  formConfiguracion,
  guardarConfiguracion,
  crearInterfaz,
  reconocerAlerta,
  resolverAlerta,
};
