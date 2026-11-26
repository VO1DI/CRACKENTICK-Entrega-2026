const Invoice = require('../models/Invoice');
const Subscription = require('../models/Subscription');
const AuditLog = require('../models/AuditLog');
const billingService = require('../services/billingService');
const clientStatusService = require('../services/clientStatusService');
const { registrar } = require('../services/auditService');
const { inicioDelMes, finDelMes } = require('../utils/dates');
const { redondear } = require('../utils/money');

/** GET /facturacion */
async function index(req, res, next) {
  try {
    const ahora = new Date();
    const [pendientes, vencidas, pagadasMes, emitidasMes, fallidos, recientes, corridas, preview] =
      await Promise.all([
        Invoice.aggregate([
          { $match: { status: { $in: billingService.ESTADOS_PENDIENTES } } },
          { $group: { _id: null, total: { $sum: '$total' }, cantidad: { $sum: 1 } } },
        ]),
        Invoice.aggregate([
          { $match: { status: 'overdue' } },
          { $group: { _id: null, total: { $sum: '$total' }, cantidad: { $sum: 1 } } },
        ]),
        Invoice.aggregate([
          { $match: { status: 'paid', paidAt: { $gte: inicioDelMes(ahora), $lte: finDelMes(ahora) } } },
          { $group: { _id: null, total: { $sum: '$total' }, cantidad: { $sum: 1 } } },
        ]),
        Invoice.countDocuments({ issueDate: { $gte: inicioDelMes(ahora), $lte: finDelMes(ahora) } }),
        Subscription.countDocuments({ firewallState: 'error' }),
        Invoice.find().populate('clientId').sort({ issueDate: -1 }).limit(6).lean(),
        AuditLog.find({ action: { $in: ['billing_issue', 'billing_overdue', 'billing_preview'] } })
          .sort({ timestamp: -1 })
          .limit(5)
          .lean(),
        billingService.previsualizar(),
      ]);

    res.render('billing/index', {
      titulo: 'Facturación',
      resumen: {
        deuda: pendientes[0]?.total || 0,
        pendientes: pendientes[0]?.cantidad || 0,
        vencido: vencidas[0]?.total || 0,
        vencidas: vencidas[0]?.cantidad || 0,
        pagadoMes: pagadasMes[0]?.total || 0,
        pagadasMes: pagadasMes[0]?.cantidad || 0,
        emitidasMes,
        fallidos,
        porEmitir: preview.items.length,
      },
      recientes,
      corridas,
      settings: res.locals.config,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /facturacion/previsualizar */
async function previsualizar(req, res, next) {
  try {
    const resultado = await billingService.previsualizar();
    const totales = resultado.items.reduce(
      (acumulado, item) => ({
        subtotal: redondear(acumulado.subtotal + item.subtotal),
        tax: redondear(acumulado.tax + item.tax),
        total: redondear(acumulado.total + item.total),
      }),
      { subtotal: 0, tax: 0, total: 0 }
    );

    await registrar({
      module: 'financial',
      entity: 'Invoice',
      action: 'billing_preview',
      description: `Previsualización de facturación: ${resultado.items.length} factura(s) elegible(s).`,
      changes: { after: { elegibles: resultado.items.length, totales } },
    });

    res.render('billing/preview', {
      titulo: 'Previsualización de facturación',
      items: resultado.items,
      omitidas: resultado.omitidas,
      totales,
      settings: resultado.settings,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /facturacion/emitir */
async function emitir(req, res, next) {
  try {
    const resumen = await billingService.emitir({ actor: 'admin' });
    const mensaje = `Facturación: ${resumen.creadas} creada(s), ${resumen.omitidas} omitida(s), ${resumen.fallidas} fallida(s).`;
    if (resumen.fallidas) {
      req.flash('error', `${mensaje} ${resumen.errores.join(' ')}`);
    } else {
      req.flash('exito', mensaje);
    }
    res.redirect('/facturacion');
  } catch (error) {
    next(error);
  }
}

/** POST /facturacion/mora */
async function mora(req, res, next) {
  try {
    const resumen = await billingService.ejecutarMora({ actor: 'system' });
    const estados = await clientStatusService.verificarEstados({ actor: 'system' });
    const mensaje = `Mora: ${resumen.vencidas} vencida(s), ${resumen.cortadas} cortada(s), ${resumen.omitidas} omitida(s), ${resumen.fallidas} fallida(s). Estados: ${estados.suspendidos} suspendido(s), ${estados.reactivados} reactivado(s).`;
    if (resumen.fallidas) {
      req.flash('error', `${mensaje} Revisa los cortes fallidos en el dashboard.`);
    } else {
      req.flash('exito', mensaje);
    }
    res.redirect('/facturacion');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, previsualizar, emitir, mora };
