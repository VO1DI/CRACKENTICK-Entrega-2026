const Invoice = require('../models/Invoice');
const FinanceEntry = require('../models/FinanceEntry');
const exchangeRateService = require('../services/exchangeRateService');
const economicsService = require('../services/economicsService');
const {
  inicioDelMes,
  finDelMes,
  inicioDelDia,
  finDelDia,
  fechaLocal,
  claveMes,
  interpretarMes,
} = require('../utils/dates');
const { redondear } = require('../utils/money');
const {
  ETIQUETAS_CATEGORIA_FINANZA,
  ETIQUETAS_ESTADO,
  METODOS_PAGO_BS,
  METODOS_PAGO_USD,
} = require('../config/constants');

function etiquetaLarga(fecha, locale = 'es-VE') {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(fecha);
  } catch (error) {
    return claveMes(fecha);
  }
}

function etiquetaDia(fecha, locale = 'es-VE') {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(fecha);
  } catch (error) {
    return fecha.toISOString().slice(0, 10);
  }
}

function etiquetaMesCorto(fecha, locale = 'es-VE') {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long' }).format(fecha);
  } catch (error) {
    return claveMes(fecha);
  }
}

function rangoPagos(periodo, referencia, fechaSolicitada, anioSolicitado) {
  if (periodo === 'diario') {
    const solicitada = fechaSolicitada ? fechaLocal(fechaSolicitada) : inicioDelMes(referencia);
    const dia = Number.isNaN(solicitada.getTime()) ? inicioDelMes(referencia) : solicitada;
    return {
      desde: inicioDelDia(dia),
      hasta: finDelDia(dia),
      etiqueta: etiquetaDia(dia),
      fecha: `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`,
      anio: dia.getFullYear(),
    };
  }
  if (periodo === 'anual') {
    const pedido = Number(anioSolicitado);
    const anio = Number.isInteger(pedido) && pedido >= 2000 && pedido <= 2100 ? pedido : referencia.getFullYear();
    return {
      desde: new Date(anio, 0, 1, 0, 0, 0, 0),
      hasta: new Date(anio, 11, 31, 23, 59, 59, 999),
      etiqueta: String(anio),
      fecha: `${anio}-01-01`,
      anio,
    };
  }
  return {
    desde: inicioDelMes(referencia),
    hasta: finDelMes(referencia),
    etiqueta: etiquetaLarga(referencia),
    fecha: `${referencia.getFullYear()}-${String(referencia.getMonth() + 1).padStart(2, '0')}-01`,
    anio: referencia.getFullYear(),
  };
}

/** GET /finanzas — contabilidad mensual, pagos por moneda y evolución. */
async function index(req, res, next) {
  try {
    const referencia = interpretarMes(req.query.mes);
    const desde = inicioDelMes(referencia);
    const hasta = finDelMes(referencia);
    const mes = claveMes(referencia);

    const anterior = new Date(referencia.getFullYear(), referencia.getMonth() - 1, 1);
    const siguiente = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 1);

    const [facturasPagadas, movimientos, tasa, pendientesCantidad] = await Promise.all([
      Invoice.find({ status: 'paid', paidAt: { $gte: desde, $lte: hasta } })
        .populate('clientId')
        .sort({ paidAt: -1 })
        .lean(),
      FinanceEntry.find({ date: { $gte: desde, $lte: hasta } }).sort({ date: -1 }).lean(),
      exchangeRateService.tasaActual(),
      Invoice.countDocuments({ status: { $in: ['open', 'overdue'] }, dueDate: { $gte: desde, $lte: hasta } }),
    ]);

    const base = ['caja', 'devengo'].includes(req.query.base) ? req.query.base : 'caja';
    const serie = await economicsService.serieEconomica(referencia, { mesActivo: mes, base });
    const actual = serie.find((item) => item.clave === mes) || serie[serie.length - 1];

    const ingresos = actual.ingresos;
    const gastos = actual.gastos;
    const gastosPendientes = redondear(
      movimientos.filter((m) => m.type === 'expense' && m.status === 'pending').reduce((t, m) => t + Number(m.amountUsd || 0), 0)
    );
    const neto = actual.utilidadNeta;
    const margen = actual.margenNeto;

    const porCategoria = {};
    /* Inventario es activo, no gasto: fuera del donut para que sume igual que `gastos`. */
    movimientos
      .filter((m) => m.type === 'expense' && m.category !== 'inventario' && (base === 'devengo' || m.status === 'paid'))
      .forEach((m) => {
        porCategoria[m.category] = redondear((porCategoria[m.category] || 0) + Number(m.amountUsd || 0));
      });
    const categorias = Object.entries(porCategoria)
      .map(([categoria, total]) => ({
        clave: categoria,
        etiqueta: ETIQUETAS_CATEGORIA_FINANZA[categoria] || categoria,
        total,
        porcentaje: gastos > 0 ? redondear((total / gastos) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const periodo = ['diario', 'mensual', 'anual'].includes(req.query.periodo) ? req.query.periodo : 'mensual';
    const rango = rangoPagos(periodo, referencia, req.query.fecha, req.query.anio);
    const pagosFacturas = await Invoice.find({ status: 'paid', paidAt: { $gte: rango.desde, $lte: rango.hasta } })
      .select('invoiceNumber total currency paidAt paymentCurrency paymentMethod paymentAmount exchangeRate type')
      .lean();

    const bs = METODOS_PAGO_BS.map((key) => ({ key, label: ETIQUETAS_ESTADO[key] || key, cantidad: 0, total: 0 }));
    const usd = METODOS_PAGO_USD.map((key) => ({ key, label: ETIQUETAS_ESTADO[key] || key, cantidad: 0, total: 0 }));
    const bsMap = new Map(bs.map((fila) => [fila.key, fila]));
    const usdMap = new Map(usd.map((fila) => [fila.key, fila]));
    let totalBs = 0;
    let totalUsd = 0;
    let countBs = 0;
    let countUsd = 0;
    let equivalenteUsd = 0;
    let equivalenteBs = 0;
    let equivalenteBsValido = true;

    const filas = new Map();
    const filaPara = (factura) => {
      const fecha = new Date(factura.paidAt);
      let clave;
      let etiqueta;
      if (periodo === 'diario') {
        clave = 'dia';
        etiqueta = etiquetaDia(fecha);
      } else if (periodo === 'anual') {
        clave = claveMes(fecha);
        etiqueta = etiquetaMesCorto(fecha);
      } else {
        clave = String(fecha.getDate()).padStart(2, '0');
        etiqueta = `${String(fecha.getDate()).padStart(2, '0')} de ${etiquetaMesCorto(fecha)}`;
      }
      if (!filas.has(clave)) {
        filas.set(clave, {
          clave,
          etiqueta,
          bs: Object.fromEntries(METODOS_PAGO_BS.map((m) => [m, 0])),
          usd: Object.fromEntries(METODOS_PAGO_USD.map((m) => [m, 0])),
          totalBs: 0,
          totalUsd: 0,
          totalCobradoUsd: 0,
        });
      }
      return filas.get(clave);
    };

    for (const factura of pagosFacturas) {
      const moneda = factura.paymentCurrency || 'USD';
      let metodo = factura.paymentMethod || 'cash';
      if (!['cash', 'transfer', 'pago_movil', 'other'].includes(metodo)) metodo = 'other';
      const monto = Number(factura.paymentAmount != null ? factura.paymentAmount : factura.total) || 0;
      const fila = filaPara(factura);
      const tasaPago = Number(factura.exchangeRate) || Number(tasa.rate) || 0;

      if (moneda === 'VES') {
        if (!bsMap.has(metodo)) metodo = 'other';
        bsMap.get(metodo).cantidad += 1;
        bsMap.get(metodo).total = redondear(bsMap.get(metodo).total + monto);
        totalBs = redondear(totalBs + monto);
        countBs += 1;
        if (tasaPago > 0) {
          const enUsd = redondear(monto / tasaPago);
          equivalenteUsd = redondear(equivalenteUsd + enUsd);
          fila.totalCobradoUsd = redondear(fila.totalCobradoUsd + enUsd);
        } else {
          equivalenteUsdValido = false;
        }
        fila.bs[metodo] = redondear((fila.bs[metodo] || 0) + monto);
        fila.totalBs = redondear(fila.totalBs + monto);
      } else {
        if (!usdMap.has(metodo)) metodo = 'other';
        usdMap.get(metodo).cantidad += 1;
        usdMap.get(metodo).total = redondear(usdMap.get(metodo).total + monto);
        totalUsd = redondear(totalUsd + monto);
        countUsd += 1;
        if (tasaPago > 0) equivalenteBs = redondear(equivalenteBs + monto * tasaPago);
        else equivalenteBsValido = false;
        fila.usd[metodo] = redondear((fila.usd[metodo] || 0) + monto);
        fila.totalUsd = redondear(fila.totalUsd + monto);
        fila.totalCobradoUsd = redondear(fila.totalCobradoUsd + monto);
      }
    }

    const desglose = [...filas.values()]
      .sort((a, b) => a.clave.localeCompare(b.clave))
      .map((fila) => ({
        ...fila,
        totalCobradoUsd: redondear(fila.totalCobradoUsd),
      }));

    const pagos = {
      periodo,
      etiqueta: rango.etiqueta,
      fecha: rango.fecha,
      mes,
      anio: rango.anio,
      bs,
      usd,
      totalBs,
      totalUsd,
      countBs,
      countUsd,
      total: countBs + countUsd,
      equivalenteUsd: equivalenteUsd || null,
      equivalenteBs: equivalenteBsValido ? equivalenteBs : null,
      tasa: tasa.rate || 0,
      tasaFuente: tasa.source || '',
      desglose,
    };

    res.render('finance/index', {
      titulo: 'Contabilidad',
      mes,
      mesEtiqueta: etiquetaLarga(referencia),
      mesAnterior: claveMes(anterior),
      mesSiguiente: claveMes(siguiente),
      resumen: {
        ingresos,
        ingresosBrutos: actual.ingresosBrutos,
        ivaCobrado: actual.ivaCobrado,
        gastos,
        gastosPendientes,
        neto,
        margen,
        costoEquipos: actual.costoEquipos,
        porCobrar: actual.pendienteCobro,
        porCobrarCantidad: pendientesCantidad,
        facturas: facturasPagadas.length,
        movimientos: movimientos.length,
      },
      serie,
      categorias,
      movimientos,
      facturas: facturasPagadas.slice(0, 12),
      economia: actual,
      pagos,
      tasa,
      base,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index, etiquetaLarga };
