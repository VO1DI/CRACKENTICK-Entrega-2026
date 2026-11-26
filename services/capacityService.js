const Subscription = require('../models/Subscription');

const DIAS_SUSPENDIDO_RECIENTE = 30;

function desdeReciente() {
  return new Date(Date.now() - DIAS_SUSPENDIDO_RECIENTE * 24 * 60 * 60 * 1000);
}

/** Filtro de servicios que cuentan como vendidos. */
function filtroVendidos(incluir = 'activos') {
  if (incluir === 'todos') return { status: { $ne: 'cancelled' } };
  if (incluir === 'recientes') {
    return {
      $or: [
        { status: 'active' },
        { status: 'suspended', lastStatusChangeAt: { $gte: desdeReciente() } },
        { status: 'suspended', firewallBlockedAt: { $gte: desdeReciente() } },
      ],
    };
  }
  return { status: 'active' };
}

function calcular(router, vendido = {}) {
  const contratadoBajada = Number(router?.contractedDownloadMbps) || 0;
  const contratadoSubida = Number(router?.contractedUploadMbps) || 0;
  const bajada = Number(vendido.download) || 0;
  const subida = Number(vendido.upload) || 0;
  const disponibleBajada = contratadoBajada - bajada;
  const disponibleSubida = contratadoSubida - subida;
  return {
    servicios: Number(vendido.servicios) || 0,
    download: bajada,
    upload: subida,
    contractedDownload: contratadoBajada,
    contractedUpload: contratadoSubida,
    availableDownload: disponibleBajada,
    availableUpload: disponibleSubida,
    usageDownload: contratadoBajada > 0 ? bajada / contratadoBajada : null,
    usageUpload: contratadoSubida > 0 ? subida / contratadoSubida : null,
    reuseDownload: contratadoBajada > 0 ? bajada / contratadoBajada : null,
    reuseUpload: contratadoSubida > 0 ? subida / contratadoSubida : null,
  };
}

/** Ventas y reuso agrupados por router. */
async function resumenPorRouter(incluir = 'activos') {
  const filas = await Subscription.aggregate([
    {
      $match: {
        ...filtroVendidos(incluir),
        'serviceConfig.routerId': { $ne: null },
      },
    },
    {
      $group: {
        _id: '$serviceConfig.routerId',
        download: { $sum: { $ifNull: ['$planSnapshot.downloadSpeed', 0] } },
        upload: { $sum: { $ifNull: ['$planSnapshot.uploadSpeed', 0] } },
        servicios: { $sum: 1 },
      },
    },
  ]);

  const mapa = new Map(filas.map((fila) => [String(fila._id), fila]));
  return (router) => calcular(router, mapa.get(String(router._id)) || {});
}

/** Servicios no cancelados de un plan en un router: base para el max-limit del padre. */
async function vendidoPlanRouter(planId, routerId) {
  const [fila] = await Subscription.aggregate([
    {
      $match: {
        planId,
        'serviceConfig.routerId': routerId,
        status: { $ne: 'cancelled' },
      },
    },
    {
      $group: {
        _id: null,
        download: { $sum: { $ifNull: ['$planSnapshot.downloadSpeed', 0] } },
        upload: { $sum: { $ifNull: ['$planSnapshot.uploadSpeed', 0] } },
        servicios: { $sum: 1 },
      },
    },
  ]);
  return fila || { download: 0, upload: 0, servicios: 0 };
}

/** Capacidad del plan en un router con la velocidad actual del plan. */
async function capacidadPlanRouter(plan, routerId) {
  const servicios = await Subscription.countDocuments({
    planId: plan._id,
    'serviceConfig.routerId': routerId,
    status: { $ne: 'cancelled' },
  });
  return {
    download: (Number(plan.downloadSpeed) || 0) * servicios,
    upload: (Number(plan.uploadSpeed) || 0) * servicios,
    servicios,
  };
}

module.exports = {
  DIAS_SUSPENDIDO_RECIENTE,
  filtroVendidos,
  calcular,
  resumenPorRouter,
  vendidoPlanRouter,
  capacidadPlanRouter,
};
