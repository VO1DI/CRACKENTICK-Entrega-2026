const InstallationReport = require('../models/InstallationReport');
const Sale = require('../models/Sale');

/** Crea (o conserva) el reporte de instalación de una venta. */
async function crearReporteInstalacion(datos = {}) {
  if (!datos.saleId) return null;
  return InstallationReport.findOneAndUpdate(
    { saleId: datos.saleId },
    {
      $setOnInsert: {
        saleId: datos.saleId,
        clientId: datos.clientId || null,
        subscriptionId: datos.subscriptionId || null,
        clientName: datos.clientName || '',
        planName: datos.planName || '',
        technician: datos.technician || '',
        installedAt: datos.installedAt || new Date(),
        notes: datos.notes || '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/** Genera los reportes que faltan para ventas ya instaladas. */
async function sincronizarInstalaciones() {
  const ventas = await Sale.find({ status: 'installed' })
    .populate('clientId')
    .populate('service.planId')
    .populate('technicianId')
    .lean();
  if (!ventas.length) return 0;

  const existentes = new Set(
    (await InstallationReport.find({ saleId: { $in: ventas.map((v) => v._id) } }).select('saleId').lean()).map((r) =>
      String(r.saleId)
    )
  );
  const pendientes = ventas.filter((v) => !existentes.has(String(v._id)));
  if (!pendientes.length) return 0;

  await InstallationReport.insertMany(
    pendientes.map((venta) => ({
      saleId: venta._id,
      clientId: venta.clientId?._id || null,
      subscriptionId: venta.subscriptionId || null,
      clientName: venta.clientId
        ? `${venta.clientId.firstName} ${venta.clientId.lastName}`.trim()
        : `${venta.customer?.firstName || ''} ${venta.customer?.lastName || ''}`.trim(),
      planName: venta.service?.planId?.name || '',
      technician: venta.technicianId?.name || '',
      installedAt: venta.installedAt || venta.createdAt,
    })),
    { ordered: false }
  ).catch((error) => {
    if (error.code !== 11000) throw error;
  });
  return pendientes.length;
}

module.exports = { crearReporteInstalacion, sincronizarInstalaciones };
