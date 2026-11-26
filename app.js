require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const morgan = require('morgan');

const Alert = require('./models/Alert');
const User = require('./models/User');
const exchangeRateService = require('./services/exchangeRateService');
const settingsCache = require('./services/settingsCache');
const alertBadgeCache = require('./services/alertBadgeCache');
const rutasAuth = require('./routes/auth');
const rutasInicio = require('./routes/index');
const rutasClientes = require('./routes/clients');
const rutasSuscripciones = require('./routes/subscriptions');
const rutasPlanes = require('./routes/plans');
const rutasFacturacion = require('./routes/billing');
const rutasFacturas = require('./routes/invoices');
const rutasConfiguracion = require('./routes/settings');
const rutasLogs = require('./routes/audit');
const rutasRouters = require('./routes/routers');
const rutasPools = require('./routes/pools');
const rutasTickets = require('./routes/tickets');
const rutasAgenda = require('./routes/agenda');
const rutasPortal = require('./routes/portal');
const rutasConsumo = require('./routes/consumption');
const rutasIpam = require('./routes/ipam');
const rutasHotspot = require('./routes/hotspot');
const rutasInventario = require('./routes/inventory');
const rutasVentas = require('./routes/sales');
const rutasMonitoreo = require('./routes/monitoring');
const rutasUsuarios = require('./routes/users');
const rutasEmpleados = require('./routes/employees');
const rutasGastos = require('./routes/expenses');
const rutasFinanzas = require('./routes/finance');
const rutasNotificaciones = require('./routes/notifications');
const rutasZonas = require('./routes/zones');
const rutasAverias = require('./routes/faultReports');
const rutasReportes = require('./routes/reports');
const rutasInstalaciones = require('./routes/installationReports');
const rutasVlans = require('./routes/vlans');
const rutasDhcp = require('./routes/dhcpServers');
const rutasBalance = require('./routes/balance');
const rutasRespaldos = require('./routes/backups');
const rutasFirewallRules = require('./routes/firewallRules');
const rutasEoip = require('./routes/eoip');
const rutasExperimental = require('./routes/experimental');
const rutasAsistente = require('./routes/assistant');
const { cargarUsuario, requiereAuth, requierePermiso, requiereAlgunPermiso } = require('./middlewares/auth');
const MongoSessionStore = require('./utils/mongoSessionStore');
const { puedeEditar } = require('./utils/permissions');
const { ejecutarConContexto } = require('./utils/context');
const { noEncontrado, manejadorErrores } = require('./middlewares/errorHandler');
const {
  ETIQUETAS_ESTADO,
  ETIQUETAS_MODULO,
  PERIODOS_DASHBOARD,
  GRUPOS_PERMISOS,
  ETIQUETAS_PERMISO,
  ETIQUETAS_ROL,
  CATEGORIAS_FINANZAS,
  ETIQUETAS_CATEGORIA_FINANZA,
  TIPOS_MOVIMIENTO_FINANZAS,
  ESTADOS_MOVIMIENTO_FINANZAS,
  TIPOS_ALERTA_RED,
} = require('./config/constants');
const { formatearDinero } = require('./utils/money');
const { formatearBps } = require('./utils/bits');
const { formatearFecha, formatearFechaHora, formatearFechaHoraExacta, sumarDias, duracionTexto, fechaParaInput } = require('./utils/dates');

const app = express();

/* Sin SESSION_SECRET no se usa una clave conocida: las sesiones se invalidan
   al reiniciar, pero nadie puede firmar una cookie desde fuera. */
const secretoConfigurado = String(process.env.SESSION_SECRET || '').trim();
const secretoPlaceholder = !secretoConfigurado
  || secretoConfigurado === 'genera-una-cadena-larga-y-aleatoria'
  || secretoConfigurado === 'cambia-esta-clave-en-produccion';
const SECRETO_SESION = secretoPlaceholder ? crypto.randomBytes(32).toString('hex') : secretoConfigurado;
if (secretoPlaceholder) {
  console.warn('⚠️  SESSION_SECRET no está configurado; se usa una clave aleatoria por arranque.');
}

// ---------------------------------------------------------------
// Motor de plantillas (EJS) + layout compartido
// ---------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// ---------------------------------------------------------------
// Middlewares generales
// ---------------------------------------------------------------
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Favicon: si el navegador pide /favicon.ico y no existe el archivo, se usa el SVG.
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

/* Salud del servicio: sin sesión ni permisos, para monitoreo externo. */
app.get('/health', (req, res) => {
  const conectado = mongoose.connection.readyState === 1;
  res.status(conectado ? 200 : 503).json({
    ok: conectado,
    db: conectado ? 'up' : 'down',
    uptimeSegundos: Math.round(process.uptime()),
    version: require('./package.json').version,
  });
});
app.use(
  methodOverride((req) => {
    if (req.body && typeof req.body._method === 'string') return req.body._method;
    if (typeof req.query._method === 'string') return req.query._method;
    return undefined;
  })
);

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(
  session({
    name: 'crackentick.sid',
    secret: SECRETO_SESION,
    store: new MongoSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);
app.use(flash());

/* Rechaza peticiones de escritura con un Origin ajeno (login CSRF incluido). */
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origen = req.get('origin');
  if (!origen) return next();
  try {
    if (new URL(origen).host === req.get('host')) return next();
  } catch (error) {
    /* Origen malformado: se rechaza abajo. */
  }
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ ok: false, mensaje: 'Origen no permitido.' });
  }
  const error = new Error('Origen no permitido.');
  error.status = 403;
  return next(error);
});

/* Token CSRF por sesión: lo envían todos los formularios y fetch de escritura. */
app.use((req, res, next) => {
  if (!req.session) return next();
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const recibido = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  const esperado = req.session.csrfToken;
  const valido = recibido.length === esperado.length
    && crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
  if (valido) return next();

  if (req.path.startsWith('/api/') || String(req.get('accept') || '').includes('application/json')) {
    return res.status(403).json({ ok: false, mensaje: 'Token CSRF inválido o vencido. Recarga la página.' });
  }
  const error = new Error('Token CSRF inválido o vencido. Recarga la página.');
  error.status = 403;
  return next(error);
});

// Usuario de sesión antes de construir los locales de las vistas.
app.use(cargarUsuario);

// La auditoría toma el usuario real desde el contexto de la petición.
app.use((req, res, next) => ejecutarConContexto({ actor: req.usuario?.username || null }, next));

// Variables y helpers disponibles en todas las vistas.
app.use(async (req, res, next) => {
  try {
    const config = await settingsCache.obtener();

    res.locals.exito = req.flash('exito');
    res.locals.error = req.flash('error');
    res.locals.rutaActual = req.path;
    res.locals.nombreApp = 'CRACKENTICK';
    res.locals.anioActual = new Date().getFullYear();
    res.locals.dbConectada = mongoose.connection.readyState === 1;
    res.locals.config = config;
    res.locals.temaUsuario = req.usuario ? (req.usuario.theme || 'oscuro') : '';
    res.locals.moneda = config.billing.currency;
    res.locals.locale = config.billing.locale;
    res.locals.etiquetas = ETIQUETAS_ESTADO;
    res.locals.erroresCampo = {};
    res.locals.errorCampo = (erroresCampo, campo) => (erroresCampo && erroresCampo[campo]) || '';
    res.locals.claseCampo = (erroresCampo, campo) => (erroresCampo && erroresCampo[campo] ? ' campo--error' : '');
    res.locals.etiquetasModulo = ETIQUETAS_MODULO;
    res.locals.periodos = PERIODOS_DASHBOARD;
    res.locals.gruposPermisos = GRUPOS_PERMISOS;
    res.locals.etiquetasPermiso = ETIQUETAS_PERMISO;
    res.locals.etiquetasRol = ETIQUETAS_ROL;
    res.locals.categoriasFinanzas = CATEGORIAS_FINANZAS;
    res.locals.etiquetasCategoria = ETIQUETAS_CATEGORIA_FINANZA;
    res.locals.tiposMovimiento = TIPOS_MOVIMIENTO_FINANZAS;
    res.locals.estadosMovimiento = ESTADOS_MOVIMIENTO_FINANZAS;
    res.locals.tasaBcv = {
      rate: exchangeRateService.normalizarTasa(config.billing.bcvRate),
      source: config.billing.bcvSource || '',
      updatedAt: config.billing.bcvUpdatedAt || null,
    };

    const tiposAlerta = [];
    if (res.locals.puede('red.monitoreo')) tiposAlerta.push(...TIPOS_ALERTA_RED);
    if (res.locals.puede('ventas.inventario')) tiposAlerta.push('stock_low');
    if (res.locals.puede('general.clientes') || res.locals.puede('red.monitoreo')) tiposAlerta.push('client_down');
    const claveAlertas = [...new Set(tiposAlerta)].join(',');
    if (!claveAlertas) {
      res.locals.notificacionesPendientes = 0;
    } else {
      const enCache = alertBadgeCache.obtener(claveAlertas);
      if (enCache !== null) {
        res.locals.notificacionesPendientes = enCache;
      } else {
        const pendientes = await Alert.countDocuments({
          type: { $in: claveAlertas.split(',') },
          status: { $in: ['active', 'acknowledged'] },
        });
        alertBadgeCache.guardar(claveAlertas, pendientes);
        res.locals.notificacionesPendientes = pendientes;
      }
    }
    res.locals.formatearDinero = (valor, currency) =>
      formatearDinero(valor, currency || config.billing.currency, config.billing.locale);
    res.locals.formatearFecha = (fecha, opciones) =>
      formatearFecha(fecha, config.billing.locale, opciones);
    res.locals.formatearFechaHora = (fecha) => formatearFechaHora(fecha, config.billing.locale);
    res.locals.formatearFechaHoraExacta = (fecha) => formatearFechaHoraExacta(fecha, config.billing.locale);
    res.locals.duracionTexto = duracionTexto;
    res.locals.fechaParaInput = (fecha, defecto) => fechaParaInput(fecha, defecto);
    res.locals.sumarDias = (fecha, dias) => sumarDias(fecha, dias);
    res.locals.formatearBps = (valor) => formatearBps(valor);
    next();
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------
// Autenticación (pública)
// ---------------------------------------------------------------
app.use(rutasAuth);
app.use('/portal', rutasPortal);

// ---------------------------------------------------------------
// Rutas protegidas por nodo
// ---------------------------------------------------------------
app.use(requiereAuth);

/* Actualiza el dólar desde dolarapi y lo guarda como respaldo. */
app.post('/api/tasa/actualizar', (req, res, next) => {
  const autorizado = req.usuario && (req.usuario.role === 'admin' || puedeEditar(req.usuario, 'finanzas.gestion') || puedeEditar(req.usuario, 'finanzas.facturacion'));
  if (!autorizado) return res.status(403).json({ ok: false, error: 'No tienes permiso para actualizar la tasa.' });
  return next();
}, async (req, res) => {
  try {
    const tasa = await exchangeRateService.obtenerTasa({ forzar: true });
    res.json({ ok: tasa.ok, rate: tasa.rate, source: tasa.source, updatedAt: tasa.updatedAt, stale: Boolean(tasa.stale), error: tasa.error || null });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

/* Preferencia de tema del usuario autenticado. */
app.post('/api/preferencias/tema', async (req, res) => {
  try {
    const tema = String(req.body.tema || '');
    if (!['oscuro', 'claro', 'claro-suave'].includes(tema)) {
      return res.status(422).json({ ok: false, mensaje: 'Tema no válido.' });
    }
    await User.updateOne({ _id: req.usuario._id }, { $set: { theme: tema } });
    return res.json({ ok: true, tema });
  } catch (error) {
    return res.status(500).json({ ok: false, mensaje: error.message });
  }
});

app.use('/notificaciones', rutasNotificaciones);
app.use('/asistente', requierePermiso('soporte.asistente'), rutasAsistente);

app.get('/sin-acceso', (req, res) =>
  res.status(403).render('errors/403', {
    titulo: 'Sin acceso',
    mensaje: 'Tu usuario no tiene ningún nodo habilitado. Pide a un administrador que te asigne permisos.',
  })
);

// General
app.use('/', rutasInicio);
app.use(
  '/clientes',
  requiereAlgunPermiso(['general.clientes', 'clientes.datos', 'clientes.servicio', 'clientes.cortes', 'clientes.facturacion']),
  rutasClientes
);
app.use(
  '/suscripciones',
  requiereAlgunPermiso(['general.clientes', 'clientes.servicio', 'clientes.cortes']),
  rutasSuscripciones
);

// Red
app.use('/red/routers', requierePermiso('red.routers'), rutasRouters);
app.use('/red/pools', requierePermiso('red.pools'), rutasPools);
app.use('/red/planes', requierePermiso('red.planes'), rutasPlanes);
app.use('/red/monitoreo', requierePermiso('red.monitoreo'), rutasMonitoreo);
app.use('/red/zonas', requierePermiso('red.zonas'), rutasZonas);
app.use('/red/vlans', requierePermiso('red.vlans'), rutasVlans);
app.use('/red/dhcp', requierePermiso('red.dhcp'), rutasDhcp);
app.use('/red/firewall', requierePermiso('red.firewall'), rutasFirewallRules);
app.use('/red/eoip', requierePermiso('red.eoip'), rutasEoip);
app.use(
  '/red/experimental',
  requiereAlgunPermiso(['red.firewall', 'red.eoip', 'red.balanceo', 'red.dhcp', 'red.routers', 'red.respaldos']),
  rutasExperimental
);
app.use('/red/balanceo', requierePermiso('red.balanceo'), rutasBalance);
app.use('/red/respaldos', requierePermiso('red.respaldos'), rutasRespaldos);
app.use('/reportes', requierePermiso('reportes.gestion'), rutasReportes);
app.use('/red/reportes/averias', requierePermiso('red.averias'), rutasAverias);
app.use('/red/reportes/instalaciones', requierePermiso('red.instalaciones'), rutasInstalaciones);

// Ventas (la ruta específica va antes para no colisionar con /:id)
app.use('/ventas/inventario', requierePermiso('ventas.inventario'), rutasInventario);
app.use('/ventas', requiereAlgunPermiso(['ventas.ventas', 'ventas.instalar']), rutasVentas);

// Soporte
app.use('/soporte/tickets', requierePermiso('soporte.tickets'), rutasTickets);
app.use('/agenda', requierePermiso('agenda.gestion'), rutasAgenda);
app.use('/red/consumo', requierePermiso('red.monitoreo'), rutasConsumo);
app.use('/red/ipam', requierePermiso('red.pools'), rutasIpam);
app.use('/hotspot', requierePermiso('hotspot.gestion'), rutasHotspot);

// Finanzas (las rutas específicas antes que la raíz)
app.use('/finanzas/facturacion', requierePermiso('finanzas.facturacion'), rutasFacturacion);
app.use('/finanzas/facturas', requierePermiso('finanzas.facturas'), rutasFacturas);
app.use('/finanzas', requierePermiso('finanzas.gestion'), rutasFinanzas);

// Administración
app.use('/admin/usuarios', requierePermiso('admin.usuarios'), rutasUsuarios);
app.use('/admin/empleados', requierePermiso('admin.empleados'), rutasEmpleados);
app.use('/admin/gastos', requierePermiso('admin.gastos'), rutasGastos);
app.use('/admin/configuracion', requierePermiso('admin.configuracion'), rutasConfiguracion);
app.use('/admin/auditoria', requierePermiso('admin.auditoria'), rutasLogs);

// ---------------------------------------------------------------
// Alias heredados (mantienen funcionando enlaces antiguos)
// ---------------------------------------------------------------
app.use('/planes', requierePermiso('red.planes'), rutasPlanes);
app.use('/routers', requierePermiso('red.routers'), rutasRouters);
app.use('/pools', requierePermiso('red.pools'), rutasPools);
app.use('/monitoreo', requierePermiso('red.monitoreo'), rutasMonitoreo);
app.use('/inventario', requierePermiso('ventas.inventario'), rutasInventario);
app.use('/tickets', requierePermiso('soporte.tickets'), rutasTickets);
app.use('/facturacion', requierePermiso('finanzas.facturacion'), rutasFacturacion);
app.use('/facturas', requierePermiso('finanzas.facturas'), rutasFacturas);
app.use('/configuracion', requierePermiso('admin.configuracion'), rutasConfiguracion);
app.use('/logs', requierePermiso('admin.auditoria'), rutasLogs);

// ---------------------------------------------------------------
// Manejo de errores
// ---------------------------------------------------------------
app.use(noEncontrado);
app.use(manejadorErrores);

module.exports = app;
