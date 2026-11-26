const mongoose = require('mongoose');
const Router = require('../models/Router');
const trafficDailyService = require('../services/trafficDailyService');

function aFecha(valor, fin = false) {
  if (!valor) return null;
  const fecha = new Date(`${String(valor).slice(0, 10)}T${fin ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function paraCampo(fecha) {
  const dos = (n) => String(n).padStart(2, '0');
  const d = fecha ? new Date(fecha) : new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** GET /red/consumo — consumo diario por cliente (últimos 90 días). */
async function index(req, res, next) {
  try {
    const ahora = new Date();
    const porDefecto = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 29);
    const desde = aFecha(req.query.desde) || porDefecto;
    const hasta = aFecha(req.query.hasta, true) || new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59);
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : '';

    const [filas, routers] = await Promise.all([
      trafficDailyService.detalle({ desde, hasta, routerId }),
      Router.find({ active: true, vendor: 'mikrotik' }).sort({ name: 1 }).select('name').lean(),
    ]);

    const porCliente = new Map();
    const porDia = new Map();
    let totalRx = 0;
    let totalTx = 0;

    for (const fila of filas) {
      const llave = String(fila.clientId?._id || 'sin-cliente');
      const cliente = fila.clientId
        ? `${fila.clientId.firstName || ''} ${fila.clientId.lastName || ''}`.trim()
        : 'Sin cliente';
      if (!porCliente.has(llave)) {
        porCliente.set(llave, {
          cliente: cliente || 'Sin cliente',
          codigo: fila.clientId?.clientCode || '-',
          rx: 0,
          tx: 0,
          dias: new Set(),
        });
      }
      const item = porCliente.get(llave);
      item.rx += fila.rxBytes || 0;
      item.tx += fila.txBytes || 0;
      item.dias.add(new Date(fila.date).toISOString().slice(0, 10));
      totalRx += fila.rxBytes || 0;
      totalTx += fila.txBytes || 0;

      const dia = new Date(fila.date).toISOString().slice(0, 10);
      porDia.set(dia, (porDia.get(dia) || 0) + (fila.rxBytes || 0) + (fila.txBytes || 0));
    }

    const clientes = [...porCliente.values()]
      .map((item) => ({ ...item, dias: item.dias.size, total: item.rx + item.tx }))
      .sort((a, b) => b.total - a.total);

    const dias = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b));

    res.render('monitoring/consumption', {
      titulo: 'Consumo diario',
      clientes,
      dias,
      totalRx,
      totalTx,
      routers,
      filtros: {
        desde: paraCampo(desde),
        hasta: paraCampo(req.query.hasta ? aFecha(req.query.hasta) : ahora),
        routerId,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index };
