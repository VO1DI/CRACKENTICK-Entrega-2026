const IpPool = require('../models/IpPool');
const Subscription = require('../models/Subscription');
const Sale = require('../models/Sale');
const { analizarCidr, ipEnCidr } = require('../utils/ip');

function agregar(mapa, ip, uso) {
  const limpia = String(ip || '').trim();
  if (!limpia) return;
  if (!mapa.has(limpia)) mapa.set(limpia, []);
  mapa.get(limpia).push(uso);
}

async function cargarUsos() {
  const [servicios, ventas] = await Promise.all([
    Subscription.find({ 'serviceConfig.ipAddress': { $nin: ['', null] } })
      .populate('clientId', 'clientCode firstName lastName status')
      .select('clientId serviceConfig status')
      .lean(),
    Sale.find({ status: 'waiting', 'service.ipAddress': { $nin: ['', null] } })
      .select('code customer service')
      .lean(),
  ]);

  const usos = new Map();
  for (const servicio of servicios) {
    agregar(usos, servicio.serviceConfig.ipAddress, {
      tipo: 'servicio',
      referencia: String(servicio._id),
      codigo: servicio.clientId?.clientCode || '-',
      cliente: servicio.clientId
        ? `${servicio.clientId.firstName || ''} ${servicio.clientId.lastName || ''}`.trim()
        : 'Sin cliente',
      estado: servicio.status,
      routerId: servicio.serviceConfig.routerId ? String(servicio.serviceConfig.routerId) : '',
    });
  }
  for (const venta of ventas) {
    agregar(usos, venta.service.ipAddress, {
      tipo: 'venta en espera',
      referencia: String(venta._id),
      codigo: venta.code || '-',
      cliente: `${venta.customer?.firstName || ''} ${venta.customer?.lastName || ''}`.trim() || 'Sin cliente',
      estado: 'waiting',
      routerId: venta.service.routerId ? String(venta.service.routerId) : '',
    });
  }
  return usos;
}

/** Ocupación de todos los pools y conflictos de direcciones. */
async function resumen() {
  const [pools, usos] = await Promise.all([
    IpPool.find({}).populate('routerId', 'name').sort({ name: 1 }).lean(),
    cargarUsos(),
  ]);

  const filas = pools.map((pool) => {
    const info = analizarCidr(pool.cidr);
    const dentro = [...usos.keys()].filter((ip) => ipEnCidr(ip, pool.cidr));
    const duplicadas = dentro.filter((ip) => usos.get(ip).length > 1);
    const total = info.ok ? info.usable : 0;
    return {
      pool,
      router: pool.routerId?.name || 'Sin router',
      cidr: pool.cidr,
      total,
      usadas: dentro.length,
      disponibles: Math.max(0, total - dentro.length),
      porcentaje: total ? Math.min(100, Math.round((dentro.length / total) * 100)) : 0,
      duplicadas: duplicadas.length,
    };
  });

  const duplicadas = [...usos.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([ip, lista]) => ({ ip, usos: lista }));

  const fuera = [...usos.entries()]
    .filter(([ip]) => !pools.some((pool) => ipEnCidr(ip, pool.cidr)))
    .map(([ip, lista]) => ({ ip, usos: lista }));

  const totales = filas.reduce(
    (acc, fila) => ({
      total: acc.total + fila.total,
      usadas: acc.usadas + fila.usadas,
      disponibles: acc.disponibles + fila.disponibles,
    }),
    { total: 0, usadas: 0, disponibles: 0 }
  );

  return {
    filas,
    duplicadas,
    fuera,
    totales: { ...totales, pools: pools.length, conflictos: duplicadas.length + fuera.length },
  };
}

/** Detalle de un pool: IPs usadas con su cliente y cuántas quedan. */
async function detalle(poolId) {
  const pool = await IpPool.findById(poolId).populate('routerId', 'name').lean();
  if (!pool) return null;
  const usos = await cargarUsos();
  const info = analizarCidr(pool.cidr);
  const dentro = [...usos.entries()]
    .filter(([ip]) => ipEnCidr(ip, pool.cidr))
    .map(([ip, lista]) => ({ ip, usos: lista }))
    .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  const total = info.ok ? info.usable : 0;
  return {
    pool,
    router: pool.routerId?.name || 'Sin router',
    total,
    usadas: dentro.length,
    disponibles: Math.max(0, total - dentro.length),
    porcentaje: total ? Math.min(100, Math.round((dentro.length / total) * 100)) : 0,
    direcciones: dentro,
  };
}

module.exports = { resumen, detalle };
