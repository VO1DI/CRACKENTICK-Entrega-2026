const Settings = require('../models/Settings');
const systemBackupService = require('../services/systemBackupService');
const Subscription = require('../models/Subscription');
const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');
const Router = require('../models/Router');
const IpPool = require('../models/IpPool');
const Plan = require('../models/Plan');
const { registrar } = require('../services/auditService');
const firewallService = require('../services/firewallService');
const routerService = require('../services/routerService');
const exchangeRateService = require('../services/exchangeRateService');
const settingsCache = require('../services/settingsCache');
const aiService = require('../services/aiService');
const telegramService = require('../services/telegramService');
const { destinosPara } = require('../services/notifyService');
const { cifrar } = require('../services/cryptoService');
const { crearError } = require('../utils/errors');
const { MONEDAS, MODOS_FIREWALL, LOCALE_POR_DEFECTO, ZONA_POR_DEFECTO, CATEGORIAS_TELEGRAM } = require('../config/constants');
const { redondear } = require('../utils/money');

/**
 * Catálogo completo de comandos RouterOS que CRACKENTICK usa por la API.
 * Se muestra en Configuración → Comandos para documentar la integración.
 */
const CATALOGO_COMANDOS = [
  {
    grupo: 'Diagnóstico y conexión',
    descripcion: 'Verificación de credenciales y lectura de identidad del equipo.',
    comandos: [
      { path: '/system/identity/print', descripcion: 'Prueba de conexión y nombre del router.', uso: 'Probar conexión del router' },
    ],
  },
  {
    grupo: 'PPPoE',
    descripcion: 'Secrets PPPoE para clientes con conexión autenticada.',
    comandos: [
      { path: '/ppp/secret/print', descripcion: 'Busca el secret por nombre antes de modificarlo.', uso: 'Lookup en update/remove/disable' },
      { path: '/ppp/secret/add', descripcion: 'Crea el secret PPPoE con nombre, servicio y comentario.', uso: 'Alta de servicio PPPoE' },
      { path: '/ppp/secret/set', descripcion: 'Actualiza el secret existente (contraseña, comentario).', uso: 'Edición de servicio' },
      { path: '/ppp/secret/remove', descripcion: 'Elimina el secret al dar de baja el servicio.', uso: 'Baja de servicio' },
      { path: '/ppp/secret/disable', descripcion: 'Deshabilita el secret para cortar el servicio.', uso: 'Corte PPPoE' },
      { path: '/ppp/secret/enable', descripcion: 'Habilita el secret para restaurar el servicio.', uso: 'Restauración PPPoE' },
      { path: '/ppp/active/print', descripcion: 'Consulta sesiones PPPoE activas y su dirección.', uso: 'Diagnóstico de conexión' },
    ],
  },
  {
    grupo: 'Colas simples',
    descripcion: 'Control de velocidad y lectura de tráfico por cliente.',
    comandos: [
      { path: '/queue/simple/add', descripcion: 'Crea la cola con target y max-limit del plan.', uso: 'Alta de servicio' },
      { path: '/queue/simple/set', descripcion: 'Actualiza max-limit al cambiar de plan.', uso: 'Sincronización de plan' },
      { path: '/queue/simple/remove', descripcion: 'Elimina la cola al dar de baja el servicio.', uso: 'Baja de servicio' },
      { path: '/queue/simple/print', descripcion: 'Lee la cola y su campo rate (rx/tx en bits/s).', uso: 'Monitor por cliente' },
    ],
  },
  {
    grupo: 'Listas de direcciones',
    descripcion: 'Registro de IPs de clientes y bloqueo por mora.',
    comandos: [
      { path: '/ip/firewall/address-list/add', descripcion: 'Agrega la IP a la lista CLIENTES o MOROSOS.', uso: 'Alta de IP y cortes' },
      { path: '/ip/firewall/address-list/print', descripcion: 'Busca la entrada por lista y dirección.', uso: 'Lookup antes de eliminar' },
      { path: '/ip/firewall/address-list/remove', descripcion: 'Quita la IP de la lista MOROSOS o CLIENTES.', uso: 'Restauración y baja' },
    ],
  },
  {
    grupo: 'Pools de IP',
    descripcion: 'Publicación de bloques CIDR en el router.',
    comandos: [
      { path: '/ip/pool/add', descripcion: 'Crea un pool con el rango usable del CIDR.', uso: 'Aplicar pool al router' },
      { path: '/ip/pool/print', descripcion: 'Verifica si el pool ya existe.', uso: 'Lookup idempotente' },
    ],
  },
  {
    grupo: 'Bloqueo por firewall',
    descripcion: 'Cortes para clientes con IP fija o DHCP.',
    comandos: [
      { path: '/ip/firewall/address-list/add · list=MOROSOS', descripcion: 'Bloquea la IP agregándola a la lista MOROSOS.', uso: 'Corte de servicio' },
      { path: '/ip/firewall/address-list/remove · [find list=MOROSOS]', descripcion: 'Restaura la IP quitándola de MOROSOS.', uso: 'Restauración de servicio' },
    ],
  },
  {
    grupo: 'Monitorización WAN',
    descripcion: 'Lectura periódica de tráfico de las interfaces monitoreadas.',
    comandos: [
      { path: '/interface/monitor-traffic · interface=<wan> once', descripcion: 'Devuelve rx-bits-per-second y tx-bits-per-second.', uso: 'Monitor WAN y fallback de cliente' },
    ],
  },
];


/**
 * Filas de bots para el formulario. Si la base viene de la versión de un solo
 * bot, se muestra esa configuración como primera fila.
 */
function botsParaVista(settings) {
  const config = settings.notifications?.telegram || {};
  const bots = (config.bots || []).map((bot) => ({
    _id: String(bot._id),
    name: bot.name || '',
    chatId: bot.chatId || '',
    categories: (bot.categories || []).slice(),
    tokenConfigured: Boolean(bot.botTokenEnc),
    legacy: false,
  }));
  if (bots.length) return bots;
  if (config.botTokenEnc || config.chatId) {
    return [{
      _id: '',
      name: 'Principal',
      chatId: config.chatId || '',
      categories: CATEGORIAS_TELEGRAM.map((categoria) => categoria.key),
      tokenConfigured: Boolean(config.botTokenEnc),
      legacy: true,
    }];
  }
  return [];
}

/** Valida y normaliza las filas del formulario de bots. */
function normalizarBots(entrada, anteriores = [], tokenAntiguo = '') {
  const filas = Array.isArray(entrada) ? entrada : entrada ? [entrada] : [];
  if (filas.length > 10) throw crearError(422, 'Puedes configurar como máximo 10 bots de Telegram.');

  const salida = [];
  for (const fila of filas) {
    if (!fila || fila.eliminar === 'on') continue;

    const anterior = anteriores.find((bot) => String(bot._id) === String(fila._id || ''));
    let tokenEnc = anterior?.botTokenEnc || (fila.legacy === 'on' ? tokenAntiguo : '');
    const token = String(fila.token || '').trim();
    if (fila.limpiarToken === 'on') tokenEnc = '';
    else if (token) {
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
        throw crearError(422, 'El token de Telegram no tiene el formato correcto (123456789:AA...).');
      }
      tokenEnc = cifrar(token);
    }

    const chatId = String(fila.chatId || '').trim();
    const categories = CATEGORIAS_TELEGRAM
      .map((categoria) => categoria.key)
      .filter((clave) => fila[`cat_${clave}`] === 'on');
    const vacia = !tokenEnc && !chatId && !categories.length && !String(fila.name || '').trim();
    if (vacia) continue;

    if (!tokenEnc) throw crearError(422, 'Cada bot necesita su token de Telegram.');
    if (!chatId) throw crearError(422, 'Cada bot necesita un chat ID.');
    if (!categories.length) throw crearError(422, 'Selecciona al menos una categoría para cada bot.');
    if (!/^(-?\d+|@[A-Za-z][A-Za-z0-9_]{3,})$/.test(chatId)) {
      throw crearError(422, 'El chat ID debe ser un número (negativo en grupos) o un @usuario de canal.');
    }

    salida.push({
      name: String(fila.name || '').trim().slice(0, 60),
      botTokenEnc: tokenEnc,
      chatId,
      categories,
    });
  }
  return salida;
}

/** GET /configuracion */
async function index(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select('+firewall.passwordEnc +ai.apiKeyEnc +ai.braveApiKeyEnc +notifications.telegram.botTokenEnc +notifications.telegram.bots.botTokenEnc');
    const tab = ['empresa', 'facturacion', 'firewall', 'ia', 'notificaciones', 'comandos', 'respaldos'].includes(req.query.tab)
      ? req.query.tab
      : 'empresa';
    const [pendientes, subscripciones] = await Promise.all([
      Invoice.countDocuments({ status: { $in: ['open', 'overdue'] } }),
      Subscription.countDocuments(),
    ]);

    res.render('settings/index', {
      titulo: 'Configuración',
      settings,
      tab,
      monedas: MONEDAS,
      modos: MODOS_FIREWALL,
      pendientes,
      subscripciones,
      catalogo: CATALOGO_COMANDOS,
      esAdmin: Boolean(req.usuario && req.usuario.role === 'admin'),
      respaldoSistema: systemBackupService.estado(),
      passwordConfigurado: Boolean(settings.firewall.passwordEnc),
      iaPasswordConfigurada: Boolean(settings.ai?.apiKeyEnc),
      braveConfigurada: Boolean(settings.ai?.braveApiKeyEnc),
      telegramBots: botsParaVista(settings),
      categoriasTelegram: CATEGORIAS_TELEGRAM,
    });
  } catch (error) {
    next(error);
  }
}

function snapshotConfig(settings) {
  return {
    company: settings.company.toObject ? settings.company.toObject() : settings.company,
    billing: {
      currency: settings.billing.currency,
      locale: settings.billing.locale,
      timezone: settings.billing.timezone,
      taxRate: settings.billing.taxRate,
      taxEnabled: settings.billing.taxEnabled !== false,
      invoicePrefix: settings.billing.invoicePrefix,
      dueDays: settings.billing.dueDays,
      graceDays: settings.billing.graceDays,
      previewDays: settings.billing.previewDays,
      bcvRate: settings.billing.bcvRate,
      bcvSource: settings.billing.bcvSource,
    },
    firewall: {
      mode: settings.firewall.mode,
      host: settings.firewall.host,
      port: settings.firewall.port,
      username: settings.firewall.username,
      tls: settings.firewall.tls,
      verifyTls: settings.firewall.verifyTls,
      routerName: settings.firewall.routerName,
    },
    ai: {
      enabled: settings.ai?.enabled,
      baseUrl: settings.ai?.baseUrl,
      model: settings.ai?.model,
      models: settings.ai?.models?.length || 0,
      braveConfigured: Boolean(settings.ai?.braveApiKeyEnc),
    },
    notifications: {
      telegram: {
        enabled: settings.notifications?.telegram?.enabled,
        bots: (settings.notifications?.telegram?.bots || []).length,
        categories: [
          ...new Set((settings.notifications?.telegram?.bots || []).flatMap((bot) => bot.categories || [])),
        ],
      },
    },
  };
}

/** PUT /configuracion/empresa */
async function actualizarEmpresa(req, res, next) {
  try {
    const settings = await Settings.getSingleton();
    const antes = settings.company.toObject ? settings.company.toObject() : settings.company;
    settings.company = {
      name: String(req.body.name || '').trim() || 'CRACKENTICK',
      taxId: String(req.body.taxId || '').trim(),
      address: String(req.body.address || '').trim(),
      phone: String(req.body.phone || '').trim(),
      email: String(req.body.email || '').trim().toLowerCase(),
    };
    await settings.save();
    settingsCache.invalidar();
    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'config_change',
      description: 'Datos de la empresa actualizados.',
      changes: { before: antes, after: settings.company.toObject ? settings.company.toObject() : settings.company },
    });
    req.flash('exito', 'Datos de la empresa guardados.');
    res.redirect('/admin/configuracion?tab=empresa');
  } catch (error) {
    next(error);
  }
}

/** PUT /configuracion/facturacion */
async function actualizarFacturacion(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select('+firewall.passwordEnc');
    const antes = snapshotConfig(settings);

    const nuevaMoneda = String(req.body.currency || settings.billing.currency).toUpperCase();
    if (nuevaMoneda !== 'USD') {
      throw crearError(422, 'La facturación de esta versión se lleva en USD. Los cobros en bolívares se calculan con la tasa BCV.');
    }
    if (!MONEDAS.some((moneda) => moneda.code === nuevaMoneda)) {
      throw crearError(422, 'La moneda seleccionada no es válida.');
    }

    const taxEnabled = req.body.taxEnabled === 'on' || req.body.taxEnabled === 'true';
    const taxPercent = Number(req.body.taxRatePercent ?? req.body.taxRate ?? settings.billing.taxRate * 100);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      throw crearError(422, 'El IVA debe estar entre 0 y 100 %.');
    }

    const dueDays = Number(req.body.dueDays);
    const graceDays = Number(req.body.graceDays);
    const previewDays = Number(req.body.previewDays);
    if ([dueDays, graceDays, previewDays].some((valor) => !Number.isInteger(valor) || valor < 0)) {
      throw crearError(422, 'Los días deben ser enteros mayores o iguales a 0.');
    }

    settings.billing.currency = nuevaMoneda;
    settings.billing.locale = String(req.body.locale || LOCALE_POR_DEFECTO).trim() || LOCALE_POR_DEFECTO;
    settings.billing.timezone = String(req.body.timezone || ZONA_POR_DEFECTO).trim() || ZONA_POR_DEFECTO;
    settings.billing.taxRate = redondear(taxPercent) / 100;
    settings.billing.taxEnabled = taxEnabled;
    settings.billing.invoicePrefix = String(req.body.invoicePrefix || 'INV').trim().toUpperCase() || 'INV';
    settings.billing.dueDays = dueDays;
    settings.billing.graceDays = graceDays;
    settings.billing.previewDays = previewDays;
    settings.billing.bcvRate = exchangeRateService.normalizarTasa(settings.billing.bcvRate);
    await settings.save();
    process.env.TZ = settings.billing.timezone;
    settingsCache.invalidar();

    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'config_change',
      description: `Configuración de facturación actualizada (${settings.billing.currency}, IVA ${taxEnabled ? `${Math.round(settings.billing.taxRate * 100)} %` : 'desactivado'}).`,
      changes: { before: antes.billing, after: snapshotConfig(settings).billing },
    });

    req.flash('exito', 'Configuración de facturación guardada.');
    res.redirect('/admin/configuracion?tab=facturacion');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/admin/configuracion?tab=facturacion');
    }
    next(error);
  }
}

/** PUT /configuracion/firewall */
async function actualizarFirewall(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select('+firewall.passwordEnc');
    const antes = snapshotConfig(settings);

    const modo = 'real';
    const host = String(req.body.host || '').trim();
    const username = String(req.body.username || '').trim();
    if (!host || !username) {
      throw crearError(422, 'Debes indicar el host y el usuario de la API.');
    }

    const puerto = Number(req.body.port || 8728);
    if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
      throw crearError(422, 'El puerto debe estar entre 1 y 65535.');
    }

    settings.firewall.mode = modo;
    settings.firewall.host = host;
    settings.firewall.port = puerto;
    settings.firewall.username = username;
    settings.firewall.tls = req.body.tls === 'on' || req.body.tls === 'true';
    settings.firewall.verifyTls = req.body.verifyTls === 'on' || req.body.verifyTls === 'true';
    settings.firewall.routerName = String(req.body.routerName || 'principal').trim() || 'principal';
    if (req.body.password) settings.firewall.passwordEnc = cifrar(req.body.password);

    await settings.save();
    settingsCache.invalidar();

    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'config_change',
      description: `Configuración de firewall actualizada (modo ${modo}).`,
      changes: { before: antes.firewall, after: snapshotConfig(settings).firewall },
    });

    req.flash('exito', 'Configuración de firewall guardada.');
    res.redirect('/admin/configuracion?tab=firewall');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/admin/configuracion?tab=firewall');
    }
    next(error);
  }
}

/** POST /configuracion/firewall/probar */
async function probar(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select('+firewall.passwordEnc');
    const resultado = await firewallService.probarConexion(settings);
    if (resultado.ok) {
      req.flash('exito', `Conexión correcta (${resultado.durationMs} ms). ${resultado.result}`);
    } else {
      req.flash('error', `La prueba de conexión falló: ${resultado.result}`);
    }
    res.redirect('/admin/configuracion?tab=firewall');
  } catch (error) {
    next(error);
  }
}

/** GET /admin/configuracion/firewall/simulador */
async function simulador(req, res, next) {
  try {
    const [suscripciones, historial] = await Promise.all([
      Subscription.find()
        .populate('clientId')
        .populate('planId')
        .sort({ createdAt: -1 })
        .lean(),
      AuditLog.find({ action: { $in: ['block', 'unblock', 'simulation'] } })
        .sort({ timestamp: -1 })
        .limit(12)
        .lean(),
    ]);

    const seleccionada = req.query.suscripcion || (suscripciones[0] ? String(suscripciones[0]._id) : '');
    const accion = req.query.accion === 'unblock' ? 'unblock' : 'block';
    let preview = null;

    if (seleccionada) {
      const subscription = await Subscription.findById(seleccionada).populate('clientId').populate('planId');
      if (subscription) {
        preview = await firewallService.previsualizar(accion, subscription);
      }
    }

    res.render('firewall/simulator', {
      titulo: 'Visor de comandos',
      suscripciones,
      seleccionada,
      accion,
      preview,
      historial,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /configuracion/firewall/simular */
async function simular(req, res, next) {
  try {
    const subscription = await Subscription.findById(req.body.subscriptionId).populate('clientId').populate('planId');
    if (!subscription) throw crearError(404, 'La suscripción no existe.');
    const accion = req.body.action === 'unblock' ? 'unblock' : 'block';
    const preview = await firewallService.previsualizar(accion, subscription);

    await registrar({
      module: 'firewall',
      entity: 'Subscription',
      entityId: subscription._id,
      action: 'simulation',
      description: `Simulación de ${accion === 'block' ? 'corte' : 'restauración'} para ${subscription.clientId?.clientCode || 'cliente'}.`,
      command: preview.comando,
      commandResult: 'SIMULACIÓN: comando mostrado y registrado, no ejecutado.',
      status: 'success',
      durationMs: 0,
    });

    req.flash('exito', 'Comando simulado registrado en auditoría. No se aplicó ningún cambio.');
    res.redirect(`/admin/configuracion/firewall/simulador?suscripcion=${subscription._id}&accion=${accion}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/admin/configuracion/firewall/simulador');
    }
    next(error);
  }
}

/** GET /admin/configuracion/provision/simulador — comandos de aprovisionamiento. */
async function simuladorAprovisionamiento(req, res, next) {
  try {
    const [subscriptions, routers, pools, planes, historial] = await Promise.all([
      Subscription.find()
        .populate('clientId')
        .populate('planId')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
      Router.find().sort({ name: 1 }).lean(),
      IpPool.find().sort({ name: 1 }).lean(),
      Plan.find().sort({ name: 1 }).lean(),
      AuditLog.find({ action: { $in: ['provision', 'sync', 'simulation'] } })
        .sort({ timestamp: -1 })
        .limit(12)
        .lean(),
    ]);

    const vista = ['servicio', 'plan', 'pool'].includes(req.query.vista) ? req.query.vista : 'servicio';
    const accion = ['create', 'update', 'delete'].includes(req.query.accion) ? req.query.accion : 'create';
    const seleccionada = req.query.suscripcion || (subscriptions[0] ? String(subscriptions[0]._id) : '');
    const planId = req.query.planId || (planes[0] ? String(planes[0]._id) : '');
    const poolId = req.query.poolId || (pools[0] ? String(pools[0]._id) : '');

    let comandos = [];
    let contexto = null;

    if (vista === 'servicio' && seleccionada) {
      const subscription = await Subscription.findById(seleccionada)
        .populate('clientId')
        .populate('planId')
        .populate('serviceConfig.routerId');
      if (subscription) {
        comandos = routerService.construirAprovisionamiento(subscription, {
          accion,
          router: subscription.serviceConfig?.routerId || null,
          plan: subscription.planId || null,
        });
        contexto = {
          tipo: 'Servicio',
          titulo: subscription.clientId?.clientCode || 'Servicio',
          detalle: subscription.clientId
            ? `${subscription.clientId.firstName} ${subscription.clientId.lastName}`
            : 'Cliente',
          router: subscription.serviceConfig?.routerId?.name || 'Automático',
        };
      }
    }

    if (vista === 'plan' && planId) {
      const plan = await Plan.findById(planId);
      if (plan) {
        const subscriptionsPlan = await Subscription.find({ planId: plan._id }).populate('clientId');
        comandos = routerService.construirSincronizacionPlan(plan, subscriptionsPlan);
        contexto = { tipo: 'Plan', titulo: plan.name, detalle: `${subscriptionsPlan.length} servicio(s)`, router: null };
      }
    }

    if (vista === 'pool' && poolId) {
      const pool = await IpPool.findById(poolId).populate('routerId');
      if (pool) {
        comandos = routerService.construirPool(pool);
        contexto = { tipo: 'Pool', titulo: pool.name, detalle: pool.cidr, router: pool.routerId?.name || 'Automático' };
      }
    }

    res.render('firewall/provisioning', {
      titulo: 'Visor de aprovisionamiento',
      subscriptions,
      routers,
      pools,
      planes,
      historial,
      vista,
      accion,
      seleccionada,
      planId,
      poolId,
      comandos,
      contexto,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /configuracion/provision/simular — audita los comandos sin ejecutarlos. */
async function simularAprovisionamiento(req, res, next) {
  try {
    const vista = ['servicio', 'plan', 'pool'].includes(req.body.vista) ? req.body.vista : 'servicio';
    const accion = ['create', 'update', 'delete'].includes(req.body.accion) ? req.body.accion : 'create';
    let comandos = [];
    let descripcion = '';

    if (vista === 'servicio') {
      const subscription = await Subscription.findById(req.body.suscripcion).populate('clientId').populate('planId');
      if (!subscription) throw crearError(404, 'El servicio no existe.');
      comandos = routerService.construirAprovisionamiento(subscription, { accion });
      descripcion = `Simulación de aprovisionamiento (${accion}) para ${subscription.clientId?.clientCode || 'servicio'}.`;
    } else if (vista === 'plan') {
      const plan = await Plan.findById(req.body.planId);
      if (!plan) throw crearError(404, 'El plan no existe.');
      const subscriptionsPlan = await Subscription.find({ planId: plan._id }).populate('clientId');
      comandos = routerService.construirSincronizacionPlan(plan, subscriptionsPlan);
      descripcion = `Simulación de sincronización de colas del plan ${plan.name}.`;
    } else {
      const pool = await IpPool.findById(req.body.poolId);
      if (!pool) throw crearError(404, 'El pool no existe.');
      comandos = routerService.construirPool(pool);
      descripcion = `Simulación de aplicación del pool ${pool.name} (${pool.cidr}).`;
    }

    await registrar({
      module: 'provisioning',
      entity: 'Subscription',
      entityId: req.body.suscripcion || req.body.planId || req.body.poolId || '',
      action: 'simulation',
      description: descripcion,
      command: comandos.map((c) => c.comando).join('\n'),
      commandResult: 'SIMULACIÓN: comandos mostrados y registrados, no ejecutados.',
      status: 'success',
      durationMs: 0,
    });

    req.flash('exito', 'Comandos de aprovisionamiento simulados y registrados en auditoría.');
    res.redirect(
      `/admin/configuracion/provision/simulador?vista=${vista}&accion=${accion}&suscripcion=${req.body.suscripcion || ''}&planId=${req.body.planId || ''}&poolId=${req.body.poolId || ''}`
    );
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/admin/configuracion/provision/simulador');
    }
    next(error);
  }
}

/** PUT /configuracion/ia */
async function actualizarIA(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select('+ai.apiKeyEnc +ai.braveApiKeyEnc');
    const antes = snapshotConfig(settings);
    const habilitado = req.body.enabled === 'on' || req.body.enabled === 'true';
    const baseUrl = String(req.body.baseUrl || '').trim().replace(/\/+$/, '');
    const modelo = String(req.body.model || '').trim();

    if (baseUrl && !/^https?:\/\/[^ ]+$/i.test(baseUrl)) {
      throw crearError(422, 'La URL base debe empezar por http:// o https://.');
    }
    if (habilitado && !baseUrl) throw crearError(422, 'Indica la URL base del proveedor de IA.');
    if (habilitado && !modelo) throw crearError(422, 'Indica el modelo de IA.');

    settings.ai.enabled = habilitado;
    settings.ai.baseUrl = baseUrl || 'https://api.openai.com/v1';
    settings.ai.model = modelo || 'gpt-4o-mini';
    if (req.body.limpiarApiKey === 'on') settings.ai.apiKeyEnc = '';
    else if (req.body.apiKey) settings.ai.apiKeyEnc = cifrar(String(req.body.apiKey).trim());
    if (req.body.limpiarBrave === 'on') settings.ai.braveApiKeyEnc = '';
    else if (req.body.braveApiKey) settings.ai.braveApiKeyEnc = cifrar(String(req.body.braveApiKey).trim());

    if (habilitado && !settings.ai.apiKeyEnc) {
      throw crearError(422, 'Para activar el asistente guarda primero la clave de la API.');
    }

    await settings.save();
    settingsCache.invalidar();
    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'config_change',
      description: `Asistente IA ${habilitado ? 'activado' : 'desactivado'} (${settings.ai.model}).`,
      changes: { before: antes.ai, after: snapshotConfig(settings).ai },
    });
    req.flash('exito', 'Configuración del asistente guardada.');
    res.redirect('/admin/configuracion?tab=ia');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/admin/configuracion?tab=ia');
    }
    next(error);
  }
}

/** POST /configuracion/ia/modelos */
async function listarModelosIA(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select('+ai.apiKeyEnc');
    const modelos = await aiService.listarModelos(settings);
    settings.ai.models = modelos;
    if (!settings.ai.model && modelos.length) settings.ai.model = modelos[0];
    await settings.save();
    settingsCache.invalidar();
    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'config_change',
      description: `Catálogo de modelos de IA actualizado (${modelos.length}).`,
      changes: { after: { modelos: modelos.length } },
    });
    req.flash('exito', `${modelos.length} modelo(s) disponibles.`);
    res.redirect('/admin/configuracion?tab=ia');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/admin/configuracion?tab=ia');
    }
    next(error);
  }
}

/** PUT /configuracion/notificaciones */
async function actualizarNotificaciones(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select(
      '+notifications.telegram.botTokenEnc +notifications.telegram.bots.botTokenEnc'
    );
    const antes = snapshotConfig(settings);
    const telegram = settings.notifications.telegram;
    const habilitado = req.body.telegramEnabled === 'on' || req.body.telegramEnabled === 'true';
    const bots = normalizarBots(req.body.bots, telegram.bots || [], telegram.botTokenEnc || '');

    if (habilitado && !bots.length) {
      throw crearError(422, 'Para activar Telegram agrega al menos un bot con token, chat ID y categoría.');
    }

    telegram.enabled = habilitado;
    telegram.bots = bots;
    /* La configuración vieja de un solo bot queda absorbida por la lista. */
    telegram.botTokenEnc = '';
    telegram.chatId = '';

    await settings.save();
    settingsCache.invalidar();
    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'config_change',
      description: `Notificaciones por Telegram ${habilitado ? 'activadas' : 'desactivadas'} (${bots.length} bot(es)).`,
      changes: { before: antes.notifications, after: snapshotConfig(settings).notifications },
    });
    req.flash('exito', 'Notificaciones por Telegram guardadas.');
    res.redirect('/admin/configuracion?tab=notificaciones');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/admin/configuracion?tab=notificaciones');
    }
    next(error);
  }
}

/** POST /configuracion/notificaciones/probar */
async function probarNotificaciones(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select(
      '+notifications.telegram.botTokenEnc +notifications.telegram.bots.botTokenEnc'
    );
    const destinos = destinosPara(settings);
    if (!destinos.length) throw crearError(422, 'No hay ningún bot configurado con token y chat ID.');

    const texto = `✅ CRACKENTICK\nPrueba de notificaciones enviada desde el panel.\nHora: ${new Date().toLocaleString('es-VE')}`;
    const resultados = await Promise.allSettled(destinos.map((bot) => telegramService.enviar(bot, texto)));
    const enviados = resultados.filter((resultado) => resultado.status === 'fulfilled').length;
    const fallos = resultados.filter((resultado) => resultado.status === 'rejected');

    if (enviados) {
      req.flash('exito', `Mensaje de prueba enviado a ${enviados} de ${destinos.length} bot(s).`);
    }
    if (fallos.length) {
      const motivo = fallos[0].reason?.message || 'error desconocido';
      req.flash('error', `Fallaron ${fallos.length} de ${destinos.length} envío(s): ${motivo}`);
    }
    res.redirect('/admin/configuracion?tab=notificaciones');
  } catch (error) {
    if (error.status) {
      req.flash('error', `No se pudo enviar la prueba: ${error.message}`);
      return res.redirect('/admin/configuracion?tab=notificaciones');
    }
    next(error);
  }
}


function esAdministrador(req) {
  return Boolean(req.usuario && req.usuario.role === 'admin');
}

/** PUT /configuracion/respaldos — guarda el destino y la programación. */
async function guardarRespaldos(req, res) {
  try {
    if (!esAdministrador(req)) throw crearError(403, 'Solo el administrador puede cambiar los respaldos del sistema.');
    const settings = await Settings.getSingleton();
    const remote = String(req.body.remote || 'gdrive').trim().replace(/:+$/, '') || 'gdrive';
    const folder = String(req.body.folder || 'CRACKENTICK-RESPALDOS').trim().replace(/^\/+|\/+$/g, '') || 'CRACKENTICK-RESPALDOS';
    const dia = Math.min(6, Math.max(0, Number(req.body.dayOfWeek) || 0));
    const hora = Math.min(23, Math.max(0, Number(req.body.hour) || 0));
    settings.backup.enabled = req.body.enabled === 'on';
    settings.backup.remote = remote;
    settings.backup.folder = folder;
    settings.backup.dayOfWeek = dia;
    settings.backup.hour = hora;
    await settings.save();
    settingsCache.invalidar();
    req.flash('exito', 'Configuración de respaldos guardada.');
    res.redirect('/admin/configuracion?tab=respaldos');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/admin/configuracion?tab=respaldos');
    }
    req.flash('error', error.message || 'No se pudo guardar la configuración de respaldos.');
    res.redirect('/admin/configuracion?tab=respaldos');
  }
}

/** POST /configuracion/respaldos/sistema — inicia el respaldo. */
async function crearRespaldoSistema(req, res) {
  try {
    if (!esAdministrador(req)) return res.status(403).json({ ok: false, mensaje: 'Solo el administrador puede crear respaldos del sistema.' });
    const estado = await systemBackupService.crear({ actor: req.usuario.username });
    res.json({ ok: true, estado });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, mensaje: error.message });
  }
}

/** GET /configuracion/respaldos/sistema/estado */
function estadoRespaldo(req, res) {
  if (!esAdministrador(req)) return res.status(403).json({ ok: false, mensaje: 'Solo el administrador.' });
  res.json({ ok: true, estado: systemBackupService.estado() });
}

/** POST /configuracion/respaldos/sistema/probar */
async function probarRespaldo(req, res) {
  try {
    if (!esAdministrador(req)) return res.status(403).json({ ok: false, mensaje: 'Solo el administrador.' });
    await systemBackupService.probarConexion();
    res.json({ ok: true, mensaje: 'Conexión con el remoto correcta.' });
  } catch (error) {
    res.json({ ok: false, mensaje: error.message });
  }
}

module.exports = {
  guardarRespaldos,
  crearRespaldoSistema,
  estadoRespaldo,
  probarRespaldo,
  index,
  actualizarEmpresa,
  actualizarFacturacion,
  actualizarFirewall,
  probar,
  simulador,
  simular,
  simuladorAprovisionamiento,
  simularAprovisionamiento,
  actualizarIA,
  listarModelosIA,
  actualizarNotificaciones,
  probarNotificaciones,
  normalizarBots,
  botsParaVista,
};
