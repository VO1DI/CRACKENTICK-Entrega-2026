const FinanceEntry = require('../models/FinanceEntry');
const { registrar } = require('../services/auditService');
const exchangeRateService = require('../services/exchangeRateService');
const { crearError, mensajeDeError } = require('../utils/errors');
const {
  TIPOS_MOVIMIENTO_FINANZAS,
  ESTADOS_MOVIMIENTO_FINANZAS,
  CATEGORIAS_FINANZAS,
  ETIQUETAS_CATEGORIA_FINANZA,
  MONEDAS_PAGO,
  METODOS_PAGO,
  METODOS_PAGO_USD,
  METODOS_PAGO_BS,
} = require('../config/constants');
const { inicioDelMes, finDelMes, claveMes, etiquetaMes, fechaParaInput, interpretarMes } = require('../utils/dates');
const { redondear } = require('../utils/money');

function payloadMovimiento(body = {}, req) {
  const type = TIPOS_MOVIMIENTO_FINANZAS.includes(body.type) ? body.type : 'expense';
  const category = CATEGORIAS_FINANZAS.includes(body.category) ? body.category : 'otros';
  const status = ESTADOS_MOVIMIENTO_FINANZAS.includes(body.status) ? body.status : 'paid';
  const amount = redondear(Number(String(body.amount || '').replace(',', '.')));
  const currency = MONEDAS_PAGO.includes(String(body.currency || '').toUpperCase())
    ? String(body.currency).toUpperCase()
    : 'USD';
  return {
    type,
    category,
    concept: String(body.concept || '').trim(),
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
    paymentMethod: METODOS_PAGO.includes(body.paymentMethod) ? body.paymentMethod : '',
    date: body.date ? new Date(`${String(body.date).slice(0, 10)}T12:00:00`) : new Date(),
    recurring: body.recurring === 'on' || body.recurring === 'true',
    vendor: String(body.vendor || '').trim(),
    status,
    reference: String(body.reference || '').trim(),
    notes: String(body.notes || '').trim(),
    createdBy: req && req.usuario ? req.usuario.username : 'sistema',
  };
}

function validar(datos) {
  const errores = [];
  if (!datos.concept) errores.push('El concepto es obligatorio.');
  if (!Number.isFinite(datos.amount) || datos.amount <= 0) errores.push('El monto debe ser mayor que cero.');
  if (Number.isNaN(new Date(datos.date).getTime())) errores.push('La fecha no es válida.');
  if (datos.type === 'income') {
    const metodos = datos.currency === 'VES' ? METODOS_PAGO_BS : METODOS_PAGO_USD;
    if (!metodos.includes(datos.paymentMethod)) errores.push('Indica cómo se pagó el ingreso.');
  }
  return errores;
}

/** Guarda la tasa del día y el equivalente en USD; los informes siempre suman en USD. */
async function convertir(datos) {
  if (datos.currency === 'VES') {
    const tasa = await exchangeRateService.obtenerTasa();
    if (!tasa.ok || !(tasa.rate > 0)) {
      throw crearError(422, 'No hay tasa BCV disponible para registrar el movimiento en bolívares.');
    }
    datos.exchangeRate = tasa.rate;
    datos.amountUsd = redondear(datos.amount / tasa.rate);
  } else {
    datos.exchangeRate = 0;
    datos.amountUsd = datos.amount;
  }
  return datos;
}

/** GET /admin/gastos — movimientos mensuales de la empresa. */
async function index(req, res, next) {
  try {
    const referencia = interpretarMes(req.query.mes);
    const desde = inicioDelMes(referencia);
    const hasta = finDelMes(referencia);
    const tipo = TIPOS_MOVIMIENTO_FINANZAS.includes(req.query.tipo) ? req.query.tipo : '';
    const categoria = CATEGORIAS_FINANZAS.includes(req.query.categoria) ? req.query.categoria : '';
    const q = String(req.query.q || '').trim();

    const consulta = { date: { $gte: desde, $lte: hasta } };
    if (tipo) consulta.type = tipo;
    if (categoria) consulta.category = categoria;
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      consulta.$or = [{ concept: regex }, { vendor: regex }, { reference: regex }];
    }

    const [movimientos, todosMes, pendientes] = await Promise.all([
      FinanceEntry.find(consulta).sort({ date: -1 }).limit(300).lean(),
      FinanceEntry.find({ date: { $gte: desde, $lte: hasta } }).lean(),
      FinanceEntry.find({ status: 'pending', type: 'expense' }).sort({ date: 1 }).limit(20).lean(),
    ]);

    const gastos = redondear(
      todosMes.filter((m) => m.type === 'expense').reduce((t, m) => t + Number(m.amountUsd ?? m.amount ?? 0), 0)
    );
    const ingresos = redondear(
      todosMes.filter((m) => m.type === 'income').reduce((t, m) => t + Number(m.amountUsd ?? m.amount ?? 0), 0)
    );
    const pendienteTotal = redondear(
      todosMes
        .filter((m) => m.type === 'expense' && m.status === 'pending')
        .reduce((t, m) => t + Number(m.amountUsd ?? m.amount ?? 0), 0)
    );

    const meses = [];
    for (let i = 5; i >= 0; i -= 1) {
      const fecha = new Date(referencia.getFullYear(), referencia.getMonth() - i, 1);
      meses.push({ clave: claveMes(fecha), etiqueta: etiquetaMes(fecha) });
    }

    res.render('expenses/index', {
      titulo: 'Gastos mensuales',
      movimientos,
      pendientes,
      filtros: { mes: claveMes(referencia), tipo, categoria, q },
      meses,
      resumen: { gastos, ingresos, neto: redondear(ingresos - gastos), pendienteTotal, cantidad: todosMes.length },
      etiquetasCategoria: ETIQUETAS_CATEGORIA_FINANZA,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /admin/gastos/nuevo */
function formNuevo(req, res) {
  const ahora = new Date();
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  res.render('expenses/form', {
    titulo: 'Nuevo movimiento',
    movimiento: {
      type: req.query.tipo === 'income' ? 'income' : 'expense',
      category: req.query.tipo === 'income' ? 'ventas' : 'proveedores',
      concept: '',
      amount: '',
      currency: 'USD',
      paymentMethod: '',
      date: hoy,
      recurring: false,
      vendor: '',
      status: 'paid',
      reference: '',
      notes: '',
    },
    modo: 'crear',
    errores: [],
    monedasPago: MONEDAS_PAGO,
    metodosPagoUsd: METODOS_PAGO_USD,
    metodosPagoBs: METODOS_PAGO_BS,
  });
}

/** POST /admin/gastos */
async function crear(req, res, next) {
  try {
    const datos = payloadMovimiento(req.body, req);
    const errores = validar(datos);
    if (!errores.length) {
      try {
        await convertir(datos);
      } catch (error) {
        errores.push(error.message);
      }
    }
    if (errores.length) {
      return res.status(422).render('expenses/form', {
        titulo: 'Nuevo movimiento',
        movimiento: { ...datos, date: fechaParaInput(datos.date) },
        modo: 'crear',
        errores,
        monedasPago: MONEDAS_PAGO,
        metodosPagoUsd: METODOS_PAGO_USD,
        metodosPagoBs: METODOS_PAGO_BS,
      });
    }

    const movimiento = await FinanceEntry.create(datos);
    await registrar({
      module: 'financial',
      entity: 'FinanceEntry',
      entityId: movimiento._id,
      action: 'create',
      description: `${datos.type === 'income' ? 'Ingreso' : 'Gasto'} registrado: ${datos.concept} (${datos.currency} ${datos.amount}${datos.paymentMethod ? `, ${datos.paymentMethod}` : ''}).`,
      changes: { after: datos },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', `${datos.type === 'income' ? 'Ingreso' : 'Gasto'} guardado correctamente.`);
    res.redirect(`/admin/gastos?mes=${claveMes(datos.date)}`);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(422).render('expenses/form', {
        titulo: 'Nuevo movimiento',
        movimiento: { ...req.body },
        modo: 'crear',
        errores: Object.values(error.errors).map((detalle) => detalle.message),
        monedasPago: MONEDAS_PAGO,
        metodosPagoUsd: METODOS_PAGO_USD,
        metodosPagoBs: METODOS_PAGO_BS,
      });
    }
    next(error);
  }
}

/** GET /admin/gastos/:id/editar */
async function formEditar(req, res, next) {
  try {
    const movimiento = await FinanceEntry.findById(req.params.id).lean();
    if (!movimiento) throw crearError(404, 'El movimiento no existe.');
    res.render('expenses/form', {
      titulo: 'Editar movimiento',
      movimiento: { ...movimiento, date: fechaParaInput(movimiento.date) },
      modo: 'editar',
      errores: [],
      monedasPago: MONEDAS_PAGO,
      metodosPagoUsd: METODOS_PAGO_USD,
      metodosPagoBs: METODOS_PAGO_BS,
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /admin/gastos/:id */
async function actualizar(req, res, next) {
  try {
    const movimiento = await FinanceEntry.findById(req.params.id);
    if (!movimiento) throw crearError(404, 'El movimiento no existe.');
    const datos = payloadMovimiento(req.body, req);
    const errores = validar(datos);
    const mismaMoneda = movimiento.currency === datos.currency;
    const mismoMonto = Number(movimiento.amount) === Number(datos.amount);
    if (!errores.length) {
      if (mismaMoneda && mismoMonto) {
        /* Editar solo concepto/fecha no debe revalorizar un mes ya cerrado. */
        datos.exchangeRate = Number(movimiento.exchangeRate) || 0;
        datos.amountUsd = Number(movimiento.amountUsd ?? movimiento.amount);
      } else if (datos.currency === 'VES' && Number(movimiento.exchangeRate) > 0) {
        datos.exchangeRate = Number(movimiento.exchangeRate);
        datos.amountUsd = redondear(datos.amount / datos.exchangeRate);
      } else {
        try {
          await convertir(datos);
        } catch (error) {
          errores.push(error.message);
        }
      }
    }
    if (errores.length) {
      return res.status(422).render('expenses/form', {
        titulo: 'Editar movimiento',
        movimiento: { ...datos, _id: movimiento._id, date: fechaParaInput(datos.date) },
        modo: 'editar',
        errores,
        monedasPago: MONEDAS_PAGO,
        metodosPagoUsd: METODOS_PAGO_USD,
        metodosPagoBs: METODOS_PAGO_BS,
      });
    }

    const antes = movimiento.toObject();
    Object.assign(movimiento, datos);
    await movimiento.save();

    await registrar({
      module: 'financial',
      entity: 'FinanceEntry',
      entityId: movimiento._id,
      action: 'update',
      description: `Movimiento actualizado: ${datos.concept}.`,
      changes: { before: antes, after: datos },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', 'Movimiento actualizado.');
    res.redirect(`/admin/gastos?mes=${claveMes(datos.date)}`);
  } catch (error) {
    if (error.name === 'ValidationError') {
      req.flash('error', mensajeDeError(error));
      return res.redirect(`/admin/gastos/${req.params.id}/editar`);
    }
    next(error);
  }
}

/** POST /admin/gastos/:id/estado */
async function cambiarEstado(req, res, next) {
  try {
    const movimiento = await FinanceEntry.findById(req.params.id);
    if (!movimiento) throw crearError(404, 'El movimiento no existe.');
    movimiento.status = movimiento.status === 'paid' ? 'pending' : 'paid';
    await movimiento.save();
    await registrar({
      module: 'financial',
      entity: 'FinanceEntry',
      entityId: movimiento._id,
      action: 'update',
      description: `Estado de ${movimiento.concept} cambiado a ${movimiento.status}.`,
      changes: { after: { status: movimiento.status } },
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    req.flash('exito', 'Estado actualizado.');
    res.redirect(`/admin/gastos?mes=${claveMes(movimiento.date)}`);
  } catch (error) {
    next(error);
  }
}

/** DELETE /admin/gastos/:id */
async function eliminar(req, res, next) {
  try {
    const movimiento = await FinanceEntry.findById(req.params.id);
    if (!movimiento) throw crearError(404, 'El movimiento no existe.');
    /* La nómina usa (employeeId + quincena) como candado de idempotencia:
       borrarla permitiría volver a pagar la misma quincena. */
    if (movimiento.employeeId || movimiento.payrollPeriod) {
      req.flash('error', 'Los pagos de nómina no se eliminan: desactiva al trabajador o ajusta su sueldo.');
      return res.redirect(`/admin/gastos?mes=${claveMes(movimiento.date)}`);
    }
    await movimiento.deleteOne();
    await registrar({
      module: 'financial',
      entity: 'FinanceEntry',
      entityId: movimiento._id,
      action: 'delete',
      description: `Movimiento eliminado: ${movimiento.concept}.`,
      changes: { before: movimiento.toObject() },
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    req.flash('exito', 'Movimiento eliminado.');
    res.redirect(`/admin/gastos?mes=${claveMes(movimiento.date)}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, cambiarEstado, eliminar };
