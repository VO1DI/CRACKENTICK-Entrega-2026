const Employee = require('../models/Employee');
const FinanceEntry = require('../models/FinanceEntry');
const exchangeRateService = require('./exchangeRateService');
const { registrar } = require('./auditService');
const { redondear } = require('../utils/money');
const { inicioDelDia, etiquetaMes } = require('../utils/dates');

/** Quincena natural: días 1–15 y 16–fin de mes. */
function quincena(fecha = new Date()) {
  const base = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), 12, 0, 0, 0);
  const primera = base.getDate() <= 15;
  const inicio = new Date(base.getFullYear(), base.getMonth(), primera ? 1 : 16, 12, 0, 0, 0);
  const fin = primera
    ? new Date(base.getFullYear(), base.getMonth(), 15, 12, 0, 0, 0)
    : new Date(base.getFullYear(), base.getMonth() + 1, 0, 12, 0, 0, 0);
  const clave = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${primera ? 'Q1' : 'Q2'}`;
  return {
    clave,
    inicio,
    fin,
    etiqueta: primera
      ? `1–15 ${etiquetaMes(inicio)}`
      : `16–${fin.getDate()} ${etiquetaMes(fin)}`,
    anio: base.getFullYear(),
    mes: base.getMonth() + 1,
  };
}

function quincenaAnterior(periodo) {
  return quincena(new Date(periodo.inicio.getTime() - 24 * 60 * 60 * 1000));
}

/** Dos quincenas cerradas más recientes; sirve para ponerse al día si el servidor estuvo apagado. */
function quincenasCerradas(hoy = new Date()) {
  const hoyDia = inicioDelDia(hoy);
  const actual = quincena(hoy);
  const ultima = hoyDia >= inicioDelDia(actual.fin) ? actual : quincenaAnterior(actual);
  return [ultima, quincenaAnterior(ultima)];
}

function proximoPago(hoy = new Date()) {
  const actual = quincena(hoy);
  return hoy.getDate() <= 15
    ? new Date(hoy.getFullYear(), hoy.getMonth(), 15, 12, 0, 0, 0)
    : new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 12, 0, 0, 0);
}

async function convertirSalario(empleado) {
  if (empleado.currency === 'VES') {
    const tasa = await exchangeRateService.obtenerTasa();
    if (!tasa.ok || !(tasa.rate > 0)) throw new Error('No hay tasa BCV para registrar la nómina en bolívares.');
    return { exchangeRate: tasa.rate, amountUsd: redondear(empleado.salary / tasa.rate) };
  }
  return { exchangeRate: 0, amountUsd: redondear(empleado.salary) };
}

/**
 * Registra una quincena como gasto de nómina. Es idempotente:
 * el índice único (employeeId + payrollPeriod) impide duplicados.
 */
async function registrarPago(empleado, periodo, { actor = 'sistema', manual = false } = {}) {
  const conversión = await convertirSalario(empleado);
  const fechaPago = manual ? new Date() : periodo.fin;
  try {
    const movimiento = await FinanceEntry.create({
      type: 'expense',
      category: 'empleados',
      concept: `Nómina ${periodo.etiqueta} · ${empleado.name}`,
      amount: redondear(empleado.salary),
      currency: empleado.currency,
      paymentMethod: empleado.paymentMethod,
      exchangeRate: conversión.exchangeRate,
      amountUsd: conversión.amountUsd,
      date: fechaPago,
      recurring: false,
      vendor: 'Nómina',
      status: 'paid',
      reference: periodo.clave,
      employeeId: empleado._id,
      payrollPeriod: periodo.clave,
      notes: manual ? 'Pago manual de quincena.' : 'Pago automático de quincena.',
      createdBy: actor,
    });

    await registrar({
      module: 'financial',
      entity: 'FinanceEntry',
      entityId: movimiento._id,
      action: 'create',
      description: `Nómina ${periodo.etiqueta} de ${empleado.name}: ${empleado.currency} ${empleado.salary}.`,
      changes: { after: { empleado: empleado.name, periodo: periodo.clave, monto: empleado.salary } },
      actor,
    });

    return { ok: true, movimiento };
  } catch (error) {
    if (error && error.code === 11000) {
      return { ok: false, duplicado: true, error: 'La quincena ya está pagada para este trabajador.' };
    }
    throw error;
  }
}

/** Crea los gastos de nómina de las quincenas cerradas que falten. */
async function procesarPendientes({ actor = 'sistema' } = {}) {
  const empleados = await Employee.find({ active: true }).lean();
  const periodos = quincenasCerradas();
  const creados = [];
  const omitidos = [];

  for (const empleado of empleados) {
    for (const periodo of periodos) {
      if (empleado.startDate && new Date(empleado.startDate) > periodo.fin) continue;
      // eslint-disable-next-line no-await-in-loop
      const resultado = await registrarPago(empleado, periodo, { actor });
      if (resultado.ok) creados.push(resultado.movimiento);
      else omitidos.push({ empleado: empleado.name, periodo: periodo.clave });
    }
  }

  return { creados, omitidos, periodos };
}

/** Pago manual de la quincena en curso (o de la más reciente cerrada). */
async function pagarQuincena(employeeId, { actor = 'admin' } = {}) {
  const empleado = await Employee.findById(employeeId).lean();
  if (!empleado) throw new Error('El trabajador no existe.');
  if (!empleado.active) throw new Error('El trabajador está inactivo.');

  const hoy = new Date();
  const periodo = quincena(hoy);
  const resultado = await registrarPago(empleado, periodo, { actor, manual: true });
  if (!resultado.ok) throw new Error(resultado.error);
  return { empleado, periodo, movimiento: resultado.movimiento };
}

/** Estado de la quincena en curso para cada trabajador (para la vista). */
async function estadoQuincena(empleados) {
  const periodo = quincena();
  const ids = empleados.map((e) => e._id);
  const pagos = await FinanceEntry.find({ employeeId: { $in: ids }, payrollPeriod: periodo.clave })
    .select('employeeId')
    .lean();
  const pagados = new Set(pagos.map((p) => String(p.employeeId)));
  return {
    periodo,
    pagados,
    pagado: (empleado) => pagados.has(String(empleado._id)),
  };
}

let programador = null;

/** Arranca la revisión automática: al iniciar y cada 6 horas. */
function iniciarProgramador() {
  if (programador) return programador;
  const ejecutar = () => {
    procesarPendientes({ actor: 'sistema' }).catch((error) => {
      console.error('⚠️  No se pudo registrar la nómina automática:', error.message);
    });
  };
  const inicial = setTimeout(ejecutar, 5000);
  if (inicial.unref) inicial.unref();
  programador = setInterval(ejecutar, 6 * 60 * 60 * 1000);
  if (programador.unref) programador.unref();
  return { inicial, programador };
}

module.exports = {
  quincena,
  quincenasCerradas,
  proximoPago,
  registrarPago,
  procesarPendientes,
  pagarQuincena,
  estadoQuincena,
  iniciarProgramador,
};
