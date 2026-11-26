const Employee = require('../models/Employee');
const FinanceEntry = require('../models/FinanceEntry');
const payrollService = require('../services/payrollService');
const { registrar } = require('../services/auditService');
const { crearError, mensajeDeError } = require('../utils/errors');
const {
  AREAS_EMPLEADO,
  ETIQUETAS_AREA_EMPLEADO,
  METODOS_PAGO,
  MONEDAS_PAGO,
} = require('../config/constants');
const { redondear } = require('../utils/money');
const { fechaParaInput } = require('../utils/dates');

function leerEmpleado(body = {}) {
  const salary = redondear(Number(String(body.salary || '').replace(',', '.')));
  return {
    name: String(body.name || '').trim(),
    position: String(body.position || '').trim(),
    area: AREAS_EMPLEADO.includes(body.area) ? body.area : 'administracion',
    userId: body.userId || null,
    salary: Number.isFinite(salary) ? salary : 0,
    currency: MONEDAS_PAGO.includes(String(body.currency || '').toUpperCase()) ? String(body.currency).toUpperCase() : 'USD',
    paymentMethod: METODOS_PAGO.includes(body.paymentMethod) ? body.paymentMethod : 'transfer',
    active: body.active === 'on' || body.active === 'true',
    startDate: body.startDate ? new Date(`${String(body.startDate).slice(0, 10)}T12:00:00`) : new Date(),
    email: String(body.email || '').trim(),
    phone: String(body.phone || '').trim(),
    notes: String(body.notes || '').trim(),
  };
}

function validar(datos) {
  const errores = [];
  if (!datos.name) errores.push('El nombre del trabajador es obligatorio.');
  if (!datos.position) errores.push('El cargo es obligatorio.');
  if (!Number.isFinite(datos.salary) || datos.salary <= 0) errores.push('El sueldo quincenal debe ser mayor que cero.');
  if (Number.isNaN(new Date(datos.startDate).getTime())) errores.push('La fecha de ingreso no es válida.');
  return errores;
}

async function opcionesFormulario() {
  const usuarios = await require('../models/User').find({ active: true }).select('name username').sort({ name: 1 }).lean();
  return {
    areas: AREAS_EMPLEADO,
    etiquetasArea: ETIQUETAS_AREA_EMPLEADO,
    monedas: MONEDAS_PAGO,
    metodos: METODOS_PAGO,
    usuarios,
  };
}

/** GET /admin/empleados */
async function index(req, res, next) {
  try {
    const empleados = await Employee.find().sort({ active: -1, area: 1, name: 1 }).lean();
    const activos = empleados.filter((e) => e.active);
    const estado = await payrollService.estadoQuincena(activos);
    const pagos = await FinanceEntry.find({ payrollPeriod: { $ne: '' } })
      .sort({ date: -1 })
      .limit(12)
      .populate('employeeId', 'name area')
      .lean();

    const conEstado = empleados.map((empleado) => ({
      ...empleado,
      pagada: estado.pagado(empleado),
      sueldoMensual: redondear((Number(empleado.salary) || 0) * 2),
    }));

    const grupos = AREAS_EMPLEADO.map((area) => ({
      area,
      label: ETIQUETAS_AREA_EMPLEADO[area],
      empleados: conEstado.filter((e) => e.area === area),
    })).filter((grupo) => grupo.empleados.length);

    const quincenal = redondear(activos.reduce((total, e) => total + Number(e.salary || 0), 0));
    const tab = req.query.tab === 'pagos' ? 'pagos' : 'trabajadores';
    res.render('employees/index', {
      titulo: 'Empleados y nómina',
      empleados: conEstado,
      grupos,
      pagos,
      tab,
      resumen: {
        total: empleados.length,
        activos: activos.length,
        quincenal,
        mensual: redondear(quincenal * 2),
        proximoPago: payrollService.proximoPago(),
        periodo: estado.periodo,
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /admin/empleados/nuevo */
async function formNuevo(req, res) {
  res.render('employees/form', {
    titulo: 'Nuevo trabajador',
    empleado: {
      name: '',
      position: '',
      area: 'administracion',
      salary: 50,
      currency: 'USD',
      paymentMethod: 'transfer',
      active: true,
      startDate: fechaParaInput(new Date()),
      email: '',
      phone: '',
      notes: '',
    },
    modo: 'crear',
    errores: [],
    ...(await opcionesFormulario()),
  });
}

/** POST /admin/empleados */
async function crear(req, res, next) {
  try {
    const datos = leerEmpleado(req.body);
    const errores = validar(datos);
    if (errores.length) {
      return res.status(422).render('employees/form', {
        titulo: 'Nuevo trabajador',
        empleado: { ...datos, startDate: fechaParaInput(datos.startDate) },
        modo: 'crear',
        errores,
        ...(await opcionesFormulario()),
      });
    }

    const empleado = await Employee.create(datos);
    await registrar({
      module: 'financial',
      entity: 'Employee',
      entityId: empleado._id,
      action: 'create',
      description: `Trabajador ${empleado.name} (${ETIQUETAS_AREA_EMPLEADO[empleado.area]}) registrado con sueldo quincenal ${empleado.currency} ${empleado.salary}.`,
      changes: { after: datos },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', `Trabajador ${empleado.name} registrado.`);
    res.redirect('/admin/empleados');
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(422).render('employees/form', {
        titulo: 'Nuevo trabajador',
        empleado: { ...req.body },
        modo: 'crear',
        errores: Object.values(error.errors).map((detalle) => detalle.message),
        ...(await opcionesFormulario()),
      });
    }
    next(error);
  }
}

/** GET /admin/empleados/:id/editar */
async function formEditar(req, res, next) {
  try {
    const empleado = await Employee.findById(req.params.id).lean();
    if (!empleado) throw crearError(404, 'El trabajador no existe.');
    res.render('employees/form', {
      titulo: `Editar ${empleado.name}`,
      empleado: { ...empleado, startDate: fechaParaInput(empleado.startDate) },
      modo: 'editar',
      errores: [],
      ...(await opcionesFormulario()),
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /admin/empleados/:id */
async function actualizar(req, res, next) {
  try {
    const empleado = await Employee.findById(req.params.id);
    if (!empleado) throw crearError(404, 'El trabajador no existe.');
    const datos = leerEmpleado(req.body);
    const errores = validar(datos);
    if (errores.length) {
      return res.status(422).render('employees/form', {
        titulo: `Editar ${empleado.name}`,
        empleado: { ...datos, _id: empleado._id, startDate: fechaParaInput(datos.startDate) },
        modo: 'editar',
        errores,
        ...(await opcionesFormulario()),
      });
    }

    const antes = empleado.toObject();
    Object.assign(empleado, datos);
    await empleado.save();
    await registrar({
      module: 'financial',
      entity: 'Employee',
      entityId: empleado._id,
      action: 'update',
      description: `Trabajador ${empleado.name} actualizado.`,
      changes: { before: antes, after: datos },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', 'Trabajador actualizado.');
    res.redirect('/admin/empleados');
  } catch (error) {
    if (error.name === 'ValidationError') {
      req.flash('error', mensajeDeError(error));
      return res.redirect(`/admin/empleados/${req.params.id}/editar`);
    }
    next(error);
  }
}

/** POST /admin/empleados/:id/pagar — pago manual de la quincena en curso. */
async function pagar(req, res, next) {
  try {
    const resultado = await payrollService.pagarQuincena(req.params.id, {
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    req.flash(
      'exito',
      `Pago de ${resultado.empleado.name} registrado: ${resultado.empleado.currency} ${resultado.empleado.salary} (${resultado.periodo.etiqueta}).`
    );
    res.redirect('/admin/empleados');
  } catch (error) {
    req.flash('error', error.message || 'No se pudo registrar el pago.');
    res.redirect('/admin/empleados');
  }
}

/** DELETE /admin/empleados/:id */
async function eliminar(req, res, next) {
  try {
    const empleado = await Employee.findById(req.params.id);
    if (!empleado) throw crearError(404, 'El trabajador no existe.');
    if (await FinanceEntry.exists({ employeeId: empleado._id })) {
      req.flash('error', 'El trabajador tiene pagos de nómina. Desactívalo en lugar de eliminarlo.');
      return res.redirect('/admin/empleados');
    }

    await Employee.deleteOne({ _id: empleado._id });
    await registrar({
      module: 'financial',
      entity: 'Employee',
      entityId: empleado._id,
      action: 'delete',
      description: `Trabajador ${empleado.name} eliminado.`,
      changes: { before: { name: empleado.name, area: empleado.area } },
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    req.flash('exito', 'Trabajador eliminado.');
    res.redirect('/admin/empleados');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, pagar, eliminar };
