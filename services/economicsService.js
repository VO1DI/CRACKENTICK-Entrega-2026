const Invoice = require('../models/Invoice');
const FinanceEntry = require('../models/FinanceEntry');
const InventoryItem = require('../models/InventoryItem');
const { inicioDelMes, finDelMes, claveMes, etiquetaMes } = require('../utils/dates');
const { redondear } = require('../utils/money');

const ESTADOS_PENDIENTES = ['open', 'overdue'];

function sumar(items, campo = 'total') {
  return redondear(items.reduce((total, item) => total + Number(item[campo] || 0), 0));
}

function dentro(fecha, desde, hasta) {
  if (!fecha) return false;
  const valor = new Date(fecha).getTime();
  return valor >= desde.getTime() && valor <= hasta.getTime();
}

/** Ingreso neto de una factura: base imponible, sin IVA. */
function ingresoFactura(factura) {
  const base = factura.taxBase != null ? factura.taxBase : factura.subtotal != null ? factura.subtotal : factura.total;
  return Number(base) || 0;
}

function costoFactura(factura, costos) {
  if (!['sale', 'installation'].includes(factura.type)) return 0;
  return redondear(
    (factura.lines || []).reduce((total, linea) => {
      if (!linea.inventoryItemId) return total;
      // Costo congelado al emitir; si la factura no lo guardó, usa el costo actual.
      const costoGuardado = Number(linea.cost) || 0;
      const costoLinea = costoGuardado > 0 ? costoGuardado : Number(costos.get(String(linea.inventoryItemId))?.cost || 0);
      return total + costoLinea * Number(linea.quantity || 0);
    }, 0)
  );
}

/**
 * Serie económica de los últimos meses, compartida por Dashboard y Contabilidad.
 * Terminología ISP: servicios, instalaciones, equipos, otros ingresos, costo de
 * equipos, gastos operativos, nómina y utilidad neta.
 */
async function serieEconomica(referencia, { cantidad = 6, mesActivo, base = 'caja' } = {}) {
  const esDevengo = base === 'devengo';
  const etiquetas = [];
  for (let i = cantidad - 1; i >= 0; i -= 1) {
    const fecha = new Date(referencia.getFullYear(), referencia.getMonth() - i, 1);
    etiquetas.push({
      clave: claveMes(fecha),
      etiqueta: etiquetaMes(fecha),
      desde: inicioDelMes(fecha),
      hasta: finDelMes(fecha),
    });
  }

  const primerMes = etiquetas[0].desde;
  const ultimoMes = etiquetas[etiquetas.length - 1].hasta;
  const consultaFacturas = esDevengo
    ? { status: { $in: ['open', 'overdue', 'paid'] }, issueDate: { $gte: primerMes, $lte: ultimoMes } }
    : { status: 'paid', paidAt: { $gte: primerMes, $lte: ultimoMes } };

  const [facturasSerie, movimientosSerie, deudasSerie] = await Promise.all([
    Invoice.find(consultaFacturas)
      .select('type taxBase subtotal total paidAt issueDate lines')
      .lean(),
    FinanceEntry.find({ date: { $gte: primerMes, $lte: ultimoMes } })
      .select('type amount amountUsd date recurring category status')
      .lean(),
    Invoice.find({ status: { $in: ESTADOS_PENDIENTES }, dueDate: { $gte: primerMes, $lte: ultimoMes } })
      .select('total dueDate')
      .lean(),
  ]);

  const inventarioIds = [
    ...new Set(
      facturasSerie.flatMap((factura) => (factura.lines || []).map((linea) => linea.inventoryItemId).filter(Boolean))
    ),
  ];
  const inventario = inventarioIds.length
    ? await InventoryItem.find({ _id: { $in: inventarioIds } }).select('cost').lean()
    : [];
  const costos = new Map(inventario.map((item) => [String(item._id), item]));

  return etiquetas.map((item) => {
    const facturas = facturasSerie.filter((f) => dentro(esDevengo ? f.issueDate : f.paidAt, item.desde, item.hasta));
    const entradas = movimientosSerie.filter((m) => dentro(m.date, item.desde, item.hasta));
    const deudas = deudasSerie.filter((f) => dentro(f.dueDate, item.desde, item.hasta));
    const gastosVigentes = entradas.filter((m) => m.type === 'expense' && (esDevengo || m.status === 'paid'));

    const sumaTipo = (tipo) =>
      redondear(facturas.filter((f) => f.type === tipo).reduce((t, f) => t + ingresoFactura(f), 0));
    const servicio = sumaTipo('service');
    const instalaciones = sumaTipo('installation');
    const equipos = sumaTipo('sale');
    const otrosFacturas = sumaTipo('other');
    const ingresosFacturas = redondear(servicio + instalaciones + equipos + otrosFacturas);
    const ingresosBrutosFacturas = redondear(facturas.reduce((t, f) => t + (Number(f.total) || 0), 0));
    const ivaCobrado = redondear(ingresosBrutosFacturas - ingresosFacturas);

    const manualIngresos = sumar(
      entradas.filter((m) => m.type === 'income' && (esDevengo || m.status === 'paid')),
      'amountUsd'
    );
    const otros = redondear(otrosFacturas + manualIngresos);
    const ingresos = redondear(ingresosFacturas + manualIngresos);
    const ingresosBrutos = redondear(ingresosBrutosFacturas + manualIngresos);

    const costoEquipos = redondear(
      facturas
        .filter((f) => ['sale', 'installation'].includes(f.type))
        .reduce((total, factura) => total + costoFactura(factura, costos), 0)
    );
    const gastosInstalaciones = sumar(gastosVigentes.filter((m) => m.category === 'instalaciones'), 'amountUsd');
    const costoDirecto = redondear(costoEquipos + gastosInstalaciones);
    const utilidadBruta = redondear(ingresos - costoDirecto);
    // Ganancia de la línea de instalaciones/equipos: no incluye mensualidades ni otros ingresos.
    const gananciaInstalaciones = redondear(instalaciones + equipos - costoDirecto);

    const comprasInventario = sumar(gastosVigentes.filter((m) => m.category === 'inventario'), 'amountUsd');
    const gastosOperativos = sumar(
      gastosVigentes.filter(
        (m) => m.category !== 'empleados' && m.category !== 'instalaciones' && m.category !== 'inventario'
      ),
      'amountUsd'
    );
    const nomina = sumar(gastosVigentes.filter((m) => m.category === 'empleados'), 'amountUsd');
    const gastos = redondear(gastosInstalaciones + gastosOperativos + nomina);
    const utilidadNeta = redondear(utilidadBruta - gastosOperativos - nomina);
    const pendienteCobro = sumar(deudas);

    return {
      ...item,
      servicio,
      instalaciones,
      equipos,
      otrosFacturas,
      manualIngresos,
      otros,
      ingresosFacturas,
      ingresosBrutosFacturas,
      ivaCobrado,
      ingresos,
      ingresosBrutos,
      costoEquipos,
      gastosInstalaciones,
      costoDirecto,
      utilidadBruta,
      gananciaInstalaciones,
      gastosOperativos,
      comprasInventario,
      nomina,
      gastos,
      utilidadNeta,
      pendienteCobro,
      deuda: pendienteCobro,
      margenBruto: ingresos > 0 ? redondear((utilidadBruta / ingresos) * 100) : 0,
      margenNeto: ingresos > 0 ? redondear((utilidadNeta / ingresos) * 100) : 0,
      activo: item.clave === mesActivo,
    };
  });
}

module.exports = { serieEconomica, ingresoFactura, costoFactura };
