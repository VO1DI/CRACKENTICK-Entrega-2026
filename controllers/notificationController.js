const Alert = require('../models/Alert');
const { registrar } = require('../services/auditService');
const alertBadgeCache = require('../services/alertBadgeCache');
const { crearError } = require('../utils/errors');
const { puedeVer, puedeEditar } = require('../utils/permissions');
const { TIPOS_ALERTA_RED } = require('../config/constants');
const ORDEN_ESTADO = { active: 0, acknowledged: 1, resolved: 2 };
const ORDEN_GRAVEDAD = { critical: 0, warning: 1, info: 2 };

function puedeAlerta(usuario, alerta, editar = false) {
  if (!alerta) return false;
  const permitido = editar ? puedeEditar : puedeVer;
  if (TIPOS_ALERTA_RED.includes(alerta.type)) return permitido(usuario, 'red.monitoreo');
  if (alerta.type === 'stock_low') return permitido(usuario, 'ventas.inventario');
  if (alerta.type === 'client_down') return permitido(usuario, 'general.clientes') || permitido(usuario, 'red.monitoreo');
  if (alerta.type === 'ticket_new') return permitido(usuario, 'soporte.tickets');
  return false;
}

/** Tipos de alerta que el usuario puede ver (o gestionar), o null si no tiene acceso. */
function tiposPermitidos(usuario, editar = false) {
  const permitido = editar ? puedeEditar : puedeVer;
  const tipos = [];
  if (permitido(usuario, 'red.monitoreo')) tipos.push(...TIPOS_ALERTA_RED);
  if (permitido(usuario, 'ventas.inventario')) tipos.push('stock_low');
  if (permitido(usuario, 'general.clientes') || permitido(usuario, 'red.monitoreo')) tipos.push('client_down');
  if (permitido(usuario, 'soporte.tickets')) tipos.push('ticket_new');
  return [...new Set(tipos)];
}

/** GET /notificaciones — alertas agrupadas por dominio y filtradas por permisos. */
async function index(req, res, next) {
  try {
    const tipos = tiposPermitidos(req.usuario);
    const estadoFiltro = ['pendientes', 'resueltas', 'todas'].includes(req.query.estado) ? req.query.estado : 'pendientes';
    if (!tipos.length) {
      return res.render('notifications/index', {
        titulo: 'Notificaciones',
        estado: estadoFiltro,
        grupos: [],
        resumen: { pendientes: 0, criticas: 0, reconocidas: 0, resueltas: 0 },
        puedeGestionar: false,
      });
    }

    const base = { type: { $in: tipos } };
    const consulta = { ...base };
    if (estadoFiltro === 'pendientes') consulta.status = { $in: ['active', 'acknowledged'] };
    if (estadoFiltro === 'resueltas') consulta.status = 'resolved';

    const [alertas, pendientes, criticas, reconocidas, resueltas] = await Promise.all([
      Alert.find(consulta).sort({ status: 1, severity: -1, startedAt: -1 }).limit(200).lean(),
      Alert.countDocuments({ ...base, status: { $in: ['active', 'acknowledged'] } }),
      Alert.countDocuments({ ...base, status: { $in: ['active', 'acknowledged'] }, severity: 'critical' }),
      Alert.countDocuments({ ...base, status: 'acknowledged' }),
      Alert.countDocuments({ ...base, status: 'resolved' }),
    ]);

    const alertasConPermiso = alertas.map((alerta) => ({
      ...alerta,
      editable: puedeAlerta(req.usuario, alerta, true),
    }));
    /* Orden real por estado y gravedad; los enums de texto no ordenan bien. */
    alertasConPermiso.sort(
      (a, b) =>
        (ORDEN_ESTADO[a.status] ?? 9) - (ORDEN_ESTADO[b.status] ?? 9) ||
        (ORDEN_GRAVEDAD[a.severity] ?? 9) - (ORDEN_GRAVEDAD[b.severity] ?? 9) ||
        new Date(b.startedAt) - new Date(a.startedAt)
    );

    const grupos = [
      { key: 'soporte', titulo: 'Soporte', descripcion: 'Tickets nuevos', icono: 'ticket', alertas: alertasConPermiso.filter((a) => a.type === 'ticket_new') },
      { key: 'red', titulo: 'Red', descripcion: 'WAN, latencia y enlaces', icono: 'gauge', alertas: alertasConPermiso.filter((a) => TIPOS_ALERTA_RED.includes(a.type)) },
      { key: 'servicio', titulo: 'Servicios', descripcion: 'Clientes sin conexión', icono: 'wifi', alertas: alertasConPermiso.filter((a) => a.type === 'client_down') },
      { key: 'stock', titulo: 'Almacén', descripcion: 'Existencias bajo mínimo', icono: 'box', alertas: alertasConPermiso.filter((a) => a.type === 'stock_low') },
    ].filter((grupo) => grupo.alertas.length);

    res.render('notifications/index', {
      titulo: 'Notificaciones',
      estado: estadoFiltro,
      grupos,
      resumen: { pendientes, criticas, reconocidas, resueltas },
      puedeGestionar: tiposPermitidos(req.usuario, true).length > 0,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /notificaciones/vista — últimos avisos para la campana y los pop-ups. */
async function vista(req, res, next) {
  try {
    const tipos = tiposPermitidos(req.usuario);
    if (!tipos.length) return res.json({ pendientes: 0, items: [] });

    const consulta = { type: { $in: tipos }, status: { $in: ['active', 'acknowledged'] } };
    const [items, pendientes] = await Promise.all([
      Alert.find(consulta).sort({ startedAt: -1 }).limit(6).lean(),
      Alert.countDocuments(consulta),
    ]);

    res.json({
      pendientes,
      items: items.map((alerta) => ({
        id: String(alerta._id),
        type: alerta.type,
        severity: alerta.severity,
        message: alerta.message,
        value: alerta.value || '',
        link: alerta.link || '',
        startedAt: alerta.startedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function cambiarEstado(req, res, next, estado) {
  try {
    const alerta = await Alert.findById(req.params.id);
    if (!alerta) throw crearError(404, 'La alerta no existe.');
    if (!puedeAlerta(req.usuario, alerta, true)) throw crearError(403, 'No tienes permiso para gestionar esta alerta.');

    const anterior = alerta.status;
    alerta.status = estado;
    if (estado === 'acknowledged') alerta.acknowledgedAt = new Date();
    if (estado === 'resolved') alerta.resolvedAt = new Date();
    await alerta.save();
    alertBadgeCache.invalidar();

    await registrar({
      module: 'monitoring',
      entity: 'Alert',
      entityId: alerta._id,
      action: 'update',
      description: `Alerta ${estado === 'acknowledged' ? 'reconocida' : 'resuelta'}: ${alerta.message}`,
      changes: { before: { status: anterior }, after: { status: estado } },
      actor: req.usuario?.username,
    });

    req.flash('exito', estado === 'acknowledged' ? 'Alerta reconocida.' : 'Alerta resuelta.');
    res.redirect('/notificaciones');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/notificaciones');
    }
    next(error);
  }
}

function reconocer(req, res, next) {
  return cambiarEstado(req, res, next, 'acknowledged');
}

function resolver(req, res, next) {
  return cambiarEstado(req, res, next, 'resolved');
}

/** POST /notificaciones/resolver-todas */
async function resolverTodas(req, res, next) {
  try {
    const tipos = tiposPermitidos(req.usuario, true);
    if (!tipos.length) throw crearError(403, 'No tienes permiso para gestionar alertas.');
    const resultado = await Alert.updateMany(
      { type: { $in: tipos }, status: { $in: ['active', 'acknowledged'] } },
      { $set: { status: 'resolved', resolvedAt: new Date() } }
    );
    alertBadgeCache.invalidar();
    await registrar({
      module: 'monitoring',
      entity: 'Alert',
      action: 'update',
      description: `Se resolvieron ${resultado.modifiedCount} alerta(s) desde Notificaciones.`,
      changes: { after: { resueltas: resultado.modifiedCount } },
      actor: req.usuario?.username,
    });
    req.flash('exito', `${resultado.modifiedCount} alerta(s) resueltas.`);
    res.redirect('/notificaciones');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/notificaciones');
    }
    next(error);
  }
}

module.exports = { index, vista, reconocer, resolver, resolverTodas, puedeAlerta, tiposPermitidos };
