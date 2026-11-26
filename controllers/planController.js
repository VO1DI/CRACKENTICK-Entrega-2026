const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Router = require('../models/Router');
const Sale = require('../models/Sale');const routerService = require('../services/routerService');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const { PLANES_POR_PAGINA } = require('../config/constants');
const { escaparRegex } = require('../utils/strings');
const { redondear } = require('../utils/money');

/** GET /planes */
async function index(req, res, next) {
  try {
    const { q = '', estado = '', page = 1 } = req.query;
    const modo = ['simple_queue', 'address_list'].includes(req.query.modo) ? req.query.modo : 'simple_queue';
    const consulta = modo === 'simple_queue'
      ? { $or: [{ trafficMode: 'simple_queue' }, { trafficMode: { $exists: false } }] }
      : { trafficMode: 'address_list' };
    if (q.trim()) consulta.name = new RegExp(escaparRegex(q.trim()), 'i');
    if (estado === 'activos') consulta.active = true;
    if (estado === 'inactivos') consulta.active = false;

    const total = await Plan.countDocuments(consulta);
    const paginas = Math.max(1, Math.ceil(total / PLANES_POR_PAGINA));
    const actual = Math.min(Math.max(1, Number(page) || 1), paginas);

    const [planes, conteos, totalServicios, porModo, activosPorModo] = await Promise.all([
      Plan.find(consulta)
        .populate('routerIds')
        .sort({ active: -1, price: 1 })
        .skip((actual - 1) * PLANES_POR_PAGINA)
        .limit(PLANES_POR_PAGINA),
      Subscription.aggregate([{ $group: { _id: '$planId', total: { $sum: 1 } } }]),
      Subscription.countDocuments({ status: 'active' }),
      Plan.aggregate([{ $group: { _id: { $ifNull: ['$trafficMode', 'simple_queue'] }, total: { $sum: 1 } } }]),
      Plan.aggregate([{ $match: { active: true } }, { $group: { _id: { $ifNull: ['$trafficMode', 'simple_queue'] }, total: { $sum: 1 } } }]),
    ]);

    const mapa = new Map(conteos.map((fila) => [String(fila._id), fila.total]));
    const planesConConteo = planes.map((plan) => ({
      ...plan.toObject({ virtuals: true }),
      servicios: mapa.get(String(plan._id)) || 0,
    }));
    const mapaModos = new Map(porModo.map((f) => [f._id, f.total]));
    const mapaActivos = new Map(activosPorModo.map((f) => [f._id, f.total]));

    res.render('plans/index', {
      titulo: 'Planes',
      planes: planesConConteo,
      filtros: { q, estado, modo },
      paginacion: { actual, paginas, total },
      modos: {
        simple_queue: { total: mapaModos.get('simple_queue') || 0, activos: mapaActivos.get('simple_queue') || 0 },
        address_list: { total: mapaModos.get('address_list') || 0, activos: mapaActivos.get('address_list') || 0 },
      },
      resumen: {
        total: await Plan.countDocuments(),
        activos: await Plan.countDocuments({ active: true }),
        servicios: totalServicios,
      },
    });
  } catch (error) {
    next(error);
  }
}

function tasaDesdePorcentaje(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0 || numero > 100) {
    throw crearError(422, 'El IVA del plan debe ser un número entre 0 y 100 %. Déjalo vacío para usar el IVA global.');
  }
  return redondear(numero) / 100;
}

function payloadPlan(body = {}, { estricto = true } = {}) {
  let taxRate = null;
  try {
    taxRate = tasaDesdePorcentaje(body.taxRatePercent);
  } catch (error) {
    if (estricto) throw error;
  }

  const trafficMode = body.trafficMode === 'address_list' ? 'address_list' : 'simple_queue';
  const routerIds = [].concat(body.routerIds || []).filter(Boolean);

  return {
    name: body.name || '',
    description: body.description || '',
    downloadSpeed: Number(body.downloadSpeed),
    uploadSpeed: Number(body.uploadSpeed),
    price: Number(body.price),
    taxRate,
    billingInterval: body.billingInterval || 'monthly',
    trafficMode,
    routerIds: trafficMode === 'address_list' ? routerIds : [],
    parentMaxDownloadMbps: Math.max(0, Number(body.parentMaxDownloadMbps) || 0),
    parentMaxUploadMbps: Math.max(0, Number(body.parentMaxUploadMbps) || 0),
    parentLimitAtDownloadMbps: Math.max(0, Number(body.parentLimitAtDownloadMbps) || 0),
    parentLimitAtUploadMbps: Math.max(0, Number(body.parentLimitAtUploadMbps) || 0),
    active: body.active === 'on' || body.active === 'true',
  };
}

/** Valida que un plan address list tenga routers y que no rompa servicios existentes. */
async function validarAlcancePlan(plan, anterior = null) {
  if (plan.trafficMode === 'address_list') {
    if (!plan.routerIds || !plan.routerIds.length) {
      const error = crearError(422, 'Selecciona al menos un router para el plan por address list.');
      error.campos = { routerIds: 'Selecciona al menos un router.' };
      throw error;
    }
    const activos = await Router.countDocuments({ _id: { $in: plan.routerIds }, active: true, planMode: 'address_list' });
    if (activos !== plan.routerIds.length) {
      const error = crearError(422, 'Alguno de los routers del plan no existe, está inactivo o no usa address list.');
      error.campos = { routerIds: 'Selecciona routers configurados para address list.' };
      throw error;
    }
  }

  if (!anterior) return;
  const servicios = await Subscription.countDocuments({ planId: plan._id });
  if (!servicios) return;

  if (plan.trafficMode !== (anterior.trafficMode || 'simple_queue')) {
    const error = crearError(422, 'No puedes cambiar el modo del plan mientras tenga servicios.');
    error.campos = { trafficMode: 'Cambia el modo solo en un plan sin servicios.' };
    throw error;
  }

  const antes = new Set((anterior.routerIds || []).map(String));
  const despues = new Set((plan.routerIds || []).map(String));
  const quitados = [...antes].filter((id) => !despues.has(id));
  if (quitados.length) {
    const usado = await Subscription.exists({ planId: plan._id, 'serviceConfig.routerId': { $in: quitados } });
    if (usado) {
      const error = crearError(422, 'No puedes quitar un router que tiene servicios de este plan.');
      error.campos = { routerIds: 'Ese router todavía tiene servicios del plan.' };
      throw error;
    }
  }
}

/** GET /planes/nuevo */
async function formNuevo(req, res, next) {
  try {
    res.render('plans/form', {
      titulo: 'Nuevo plan',
      plan: new Plan({ active: true, billingInterval: 'monthly', trafficMode: 'simple_queue' }),
      routers: await Router.find({ active: true, planMode: 'address_list' }).sort({ name: 1 }).lean(),
      modo: 'crear',
      errores: [],
      erroresCampo: {},
    });
  } catch (error) {
    next(error);
  }
}

/** POST /planes */
async function crear(req, res, next) {
  try {
    const plan = new Plan(payloadPlan(req.body));
    await validarAlcancePlan(plan);
    await plan.save();
    await registrar({
      module: 'commercial',
      entity: 'Plan',
      entityId: plan._id,
      action: 'create',
      description: `Plan ${plan.name} creado (${plan.speedLabel}, ${plan.trafficMode === 'address_list' ? 'address list' : 'cola simple'}).`,
      changes: { after: { name: plan.name, price: plan.price, interval: plan.billingInterval, trafficMode: plan.trafficMode } },
    });
    req.flash('exito', `Plan ${plan.name} creado correctamente.`);
    res.redirect(`/planes?modo=${plan.trafficMode}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('plans/form', {
        titulo: 'Nuevo plan',
        plan: new Plan(payloadPlan(req.body, { estricto: false })),
        routers: await Router.find({ active: true, planMode: 'address_list' }).sort({ name: 1 }).lean(),
        modo: 'crear',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** GET /planes/:id/editar */
async function formEditar(req, res, next) {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) throw crearError(404, 'El plan no existe.');
    res.render('plans/form', {
      titulo: `Editar ${plan.name}`,
      plan,
      routers: await Router.find({ active: true, planMode: 'address_list' }).sort({ name: 1 }).lean(),
      modo: 'editar',
      errores: [],
      erroresCampo: {},
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /planes/:id */
async function actualizar(req, res, next) {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) throw crearError(404, 'El plan no existe.');
    const antes = {
      name: plan.name,
      price: plan.price,
      speeds: plan.speedLabel,
      trafficMode: plan.trafficMode || 'simple_queue',
      routerIds: (plan.routerIds || []).map(String),
    };
    Object.assign(plan, payloadPlan(req.body));
    await validarAlcancePlan(plan, antes);
    await plan.save();

    let sincronizacion = null;
    try {
      sincronizacion = await routerService.sincronizarPlan(plan);
    } catch (error) {
      console.error('⚠️  No se pudieron sincronizar las colas del plan:', error.message);
    }

    await registrar({
      module: 'commercial',
      entity: 'Plan',
      entityId: plan._id,
      action: 'update',
      description: `Plan ${plan.name} actualizado${sincronizacion?.comandos?.length ? ` y ${sincronizacion.comandos.length} cola(s) sincronizada(s)` : ''}.`,
      changes: { before: antes, after: { name: plan.name, price: plan.price, speeds: plan.speedLabel } },
    });

    req.flash(
      'exito',
      `Plan actualizado. Las facturas ya emitidas conservan su snapshot.${sincronizacion?.comandos?.length ? ` Se sincronizaron ${sincronizacion.comandos.length} cola(s) en los routers.` : ''}`
    );
    res.redirect('/planes');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const plan = await Plan.findById(req.params.id);
      if (plan) Object.assign(plan, payloadPlan(req.body, { estricto: false }));
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('plans/form', {
        titulo: `Editar ${plan?.name || 'plan'}`,
        plan: plan || new Plan(payloadPlan(req.body, { estricto: false })),
        routers: await Router.find({ active: true, planMode: 'address_list' }).sort({ name: 1 }).lean(),
        modo: 'editar',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** POST /planes/:id/estado */
async function alternarEstado(req, res, next) {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) throw crearError(404, 'El plan no existe.');
    plan.active = !plan.active;
    await plan.save();
    await registrar({
      module: 'commercial',
      entity: 'Plan',
      entityId: plan._id,
      action: 'update',
      description: `Plan ${plan.name} ${plan.active ? 'activado' : 'desactivado'}.`,
      changes: { after: { active: plan.active } },
    });
    req.flash('exito', `Plan ${plan.name} ${plan.active ? 'activado' : 'desactivado'}.`);
    res.redirect('/planes');
  } catch (error) {
    next(error);
  }
}

/** DELETE /planes/:id */
async function eliminar(req, res, next) {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) throw crearError(404, 'El plan no existe.');
    const servicios = await Subscription.countDocuments({ planId: plan._id });
    const ventas = await Sale.countDocuments({ status: 'waiting', 'service.planId': plan._id });
    if (servicios || ventas) {
      req.flash('error', `No se puede eliminar ${plan.name}: tiene ${servicios} servicio(s) y ${ventas} venta(s) en espera. Desactívalo en su lugar.`);
      return res.redirect('/planes');
    }
    const limpieza = await routerService.eliminarPlan(plan, { actor: req.usuario?.username || 'admin' });
    if (!limpieza.ok) {
      req.flash('error', `No se pudo retirar el plan del router. Revisa la auditoría y vuelve a intentar.`);
      return res.redirect('/planes');
    }
    await plan.deleteOne();
    await registrar({
      module: 'commercial',
      entity: 'Plan',
      entityId: plan._id,
      action: 'delete',
      description: `Plan ${plan.name} eliminado.`,
      changes: { before: { name: plan.name, price: plan.price } },
    });
    req.flash('exito', 'Plan eliminado correctamente.');
    res.redirect('/planes');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, alternarEstado, eliminar };
