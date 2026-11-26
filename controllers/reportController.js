const Sale = require('../models/Sale');
const InstallationReport = require('../models/InstallationReport');
const FaultReport = require('../models/FaultReport');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');
const InventoryItem = require('../models/InventoryItem');
const { stockDisponible } = require('../services/inventoryService');

function inicioDelMes() {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
}

/** GET /reportes — resumen y accesos a los reportes del sistema. */
async function index(req, res, next) {
  try {
    const desde = inicioDelMes();
    const [instalacionesMes, averiasAbiertas, averiasMes, facturasVencidas, deuda, clientesActivos, clientesSuspendidos, serviciosActivos, inventario, ventasInstaladas] =
      await Promise.all([
        InstallationReport.countDocuments({ installedAt: { $gte: desde } }),
        FaultReport.countDocuments({ status: { $ne: 'solved' } }),
        FaultReport.countDocuments({ faultDate: { $gte: desde } }),
        Invoice.countDocuments({ status: 'overdue' }),
        Invoice.aggregate([{ $match: { status: 'overdue' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
        Client.countDocuments({ status: 'active' }),
        Client.countDocuments({ status: 'suspended' }),
        Subscription.countDocuments({ status: 'active' }),
        InventoryItem.find({ active: true }).lean(),
        Sale.countDocuments({ status: 'installed', installedAt: { $gte: desde } }),
      ]);

    res.render('reports/index', {
      titulo: 'Reportes',
      resumen: {
        instalacionesMes,
        averiasAbiertas,
        averiasMes,
        facturasVencidas,
        deuda: deuda[0]?.total || 0,
        clientesActivos,
        clientesSuspendidos,
        serviciosActivos,
        stockBajo: inventario.filter((item) => stockDisponible(item) <= Number(item.minStock || 0)).length,
        ventasInstaladas,
        desde,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index };
