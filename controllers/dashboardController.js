const Client = require('../models/Client');
const Subscription = require('../models/Subscription');
const Sale = require('../models/Sale');
const Invoice = require('../models/Invoice');
const Ticket = require('../models/Ticket');
const InventoryItem = require('../models/InventoryItem');
const Alert = require('../models/Alert');
const billingService = require('../services/billingService');
const economicsService = require('../services/economicsService');
const exchangeRateService = require('../services/exchangeRateService');
const { TIPOS_ALERTA_RED } = require('../config/constants');
const { puedeVer } = require('../utils/permissions');
const { claveMes } = require('../utils/dates');

const ORDEN_PRIORIDAD = { urgent: 0, high: 1, medium: 2, low: 3 };
const ORDEN_GRAVEDAD = { critical: 0, warning: 1, info: 2 };

/** GET / — dashboard compacto, limitado a los permisos del usuario. */
async function index(req, res, next) {
  try {
    const ahora = new Date();
    const base = ['caja', 'devengo'].includes(req.query.base) ? req.query.base : 'caja';
    const usuario = req.usuario;
    const puede = (clave) => puedeVer(usuario, clave);

    const ver = {
      clientes: puede('general.clientes'),
      finanzas: puede('finanzas.facturas') || puede('finanzas.gestion'),
      tickets: puede('soporte.tickets'),
      red: puede('red.monitoreo'),
      stock: puede('ventas.inventario'),
      ventas: puede('ventas.ventas'),
      routers: puede('red.routers'),
      facturacion: puede('finanzas.facturacion'),
      configuracion: puede('admin.configuracion'),
    };

    const [
      clientesActivos,
      serviciosActivos,
      deuda,
      ticketsAbiertos,
      ticketsRecientes,
      alertas,
      stockBajo,
      serie,
      tasa,
      instalacionesMes,
      clientesRetirados,
      clientesSuspendidos,
    ] = await Promise.all([
      ver.clientes ? Client.countDocuments({ status: 'active' }) : 0,
      ver.clientes ? Subscription.countDocuments({ status: 'active' }) : 0,
      ver.finanzas
        ? Invoice.aggregate([
            { $match: { status: { $in: billingService.ESTADOS_PENDIENTES } } },
            { $group: { _id: null, total: { $sum: '$total' }, cantidad: { $sum: 1 } } },
          ])
        : [],
      ver.tickets ? Ticket.countDocuments({ status: { $in: ['open', 'in_progress'] } }) : 0,
      ver.tickets
        ? Ticket.find({ status: { $in: ['open', 'in_progress'] } })
            .populate('clientId')
            .sort({ createdAt: -1 })
            .limit(20)
            .lean()
        : [],
      ver.red
        ? Alert.find({ status: { $in: ['active', 'acknowledged'] }, type: { $in: TIPOS_ALERTA_RED } }).sort({ startedAt: -1 }).limit(20).lean()
        : [],
      ver.stock ? InventoryItem.find({ active: true }).sort({ name: 1 }) : [],
      ver.finanzas ? economicsService.serieEconomica(ahora, { mesActivo: claveMes(ahora), base }) : [],
      ver.finanzas ? exchangeRateService.tasaActual() : { rate: 0 },
      ver.clientes
        ? Sale.countDocuments({
            status: 'installed',
            installedAt: { $gte: new Date(ahora.getFullYear(), ahora.getMonth(), 1) },
          })
        : 0,
      ver.clientes ? Client.countDocuments({ status: 'retired' }) : 0,
      ver.clientes ? Client.countDocuments({ status: 'suspended' }) : 0,
    ]);

    const bajoMinimo = stockBajo.filter((item) => item.bajoMinimo).slice(0, 5);
    const actualMes = serie.find((item) => item.clave === claveMes(ahora)) || { ingresos: 0, ingresosBrutos: 0 };
    /* Los enums son texto: el orden por prioridad/gravedad se hace en memoria. */
    const ticketsOrdenados = ticketsRecientes
      .sort((a, b) => (ORDEN_PRIORIDAD[a.priority] ?? 9) - (ORDEN_PRIORIDAD[b.priority] ?? 9))
      .slice(0, 5);
    const alertasOrdenadas = alertas
      .sort((a, b) => (ORDEN_GRAVEDAD[a.severity] ?? 9) - (ORDEN_GRAVEDAD[b.severity] ?? 9))
      .slice(0, 6);

    res.render('dashboard/index', {
      titulo: 'Dashboard',
      ver,
      base,
      kpis: {
        ingresos: actualMes.ingresos,
        ingresosBrutos: actualMes.ingresosBrutos,
        serviciosActivos,
        clientesActivos,
        deudaTotal: deuda[0]?.total || 0,
        deudaCantidad: deuda[0]?.cantidad || 0,
        ticketsAbiertos,
      },
      serie,
      tasa: tasa.rate || 0,
      alertas: alertasOrdenadas,
      ticketsRecientes: ticketsOrdenados,
      stockBajo: bajoMinimo,
      altasBajas: {
        instalaciones: instalacionesMes,
        retirados: clientesRetirados,
        suspendidos: clientesSuspendidos,
      },
      etiquetaMes: ahora.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' }),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index };
