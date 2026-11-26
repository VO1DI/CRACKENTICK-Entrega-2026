const IpPool = require('../models/IpPool');
const Router = require('../models/Router');
const Subscription = require('../models/Subscription');
const Sale = require('../models/Sale');
const routerService = require('../services/routerService');
const { registrar } = require('../services/auditService');
const { crearError, mensajeDeError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const { analizarCidr, enumerarCidr } = require('../utils/ip');
const { PROPOSITOS_POOL } = require('../config/constants');
const { escaparRegex } = require('../utils/strings');

function payloadPool(body = {}) {
  return {
    name: body.name || '',
    cidr: body.cidr || '',
    routerId: body.routerId || null,
    purpose: PROPOSITOS_POOL.includes(body.purpose) ? body.purpose : 'mixed',
    autoProvision: body.autoProvision === 'on' || body.autoProvision === 'true',
    active: body.active === 'on' || body.active === 'true',
    notes: body.notes || '',
  };
}

/** GET /pools */
async function index(req, res, next) {
  try {
    const { q = '', routerId = '', page = 1 } = req.query;
    const consulta = {};
    if (q.trim()) consulta.name = new RegExp(escaparRegex(q.trim()), 'i');
    if (routerId) consulta.routerId = routerId;

    const porPagina = 12;
    const total = await IpPool.countDocuments(consulta);
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const actual = Math.min(Math.max(1, Number(page) || 1), paginas);

    const [pools, routers, uso] = await Promise.all([
      IpPool.find(consulta).populate('routerId').sort({ name: 1 }).skip((actual - 1) * porPagina).limit(porPagina),
      Router.find({ active: true }).sort({ name: 1 }).lean(),
      Subscription.aggregate([
        { $match: { 'serviceConfig.ipPoolId': { $ne: null } } },
        { $group: { _id: '$serviceConfig.ipPoolId', total: { $sum: 1 } } },
      ]),
    ]);
    const mapaUso = new Map(uso.map((f) => [String(f._id), f.total]));

    res.render('pools/index', {
      titulo: 'Pools de IP',
      pools: pools.map((pool) => {
        const datos = analizarCidr(pool.cidr);
        const usadas = mapaUso.get(String(pool._id)) || 0;
        return {
          ...pool.toObject({ virtuals: true }),
          datosCidr: datos,
          usadas,
          libres: Math.max(0, (datos.usable || 0) - usadas),
          porcentaje: datos.usable ? Math.min(100, Math.round((usadas / datos.usable) * 100)) : 0,
          muestra: enumerarCidr(pool.cidr, 8),
        };
      }),
      routers,
      filtros: { q, routerId },
      paginacion: { actual, paginas, total },
      resumen: {
        total,
        direcciones: pools.reduce((suma, pool) => suma + (analizarCidr(pool.cidr).usable || 0), 0),
        asignadas: uso.reduce((suma, fila) => suma + fila.total, 0),
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /pools/nuevo */
async function formNuevo(req, res, next) {
  try {
    const routers = await Router.find({ active: true }).sort({ name: 1 }).lean();
    res.render('pools/form', {
      titulo: 'Nuevo pool',
      pool: new IpPool({ purpose: 'pppoe', autoProvision: true, active: true }),
      routers,
      modo: 'crear',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** POST /pools */
async function crear(req, res, next) {
  try {
    const pool = new IpPool(payloadPool(req.body));
    await pool.save();
    await registrar({
      module: 'provisioning',
      entity: 'IpPool',
      entityId: pool._id,
      action: 'create',
      description: `Pool ${pool.name} (${pool.cidr}) creado.`,
      changes: { after: { name: pool.name, cidr: pool.cidr, routerId: pool.routerId } },
    });
    req.flash('exito', `Pool ${pool.name} creado con ${analizarCidr(pool.cidr).usable} direcciones usables.`);
    res.redirect('/pools');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const routers = await Router.find({ active: true }).sort({ name: 1 }).lean();
      return res.status(422).render('pools/form', {
        titulo: 'Nuevo pool',
        pool: new IpPool(payloadPool(req.body)),
        routers,
        modo: 'crear',
        errores: error.name === 'ValidationError' ? Object.values(error.errors).map((d) => d.message) : [mensajeDeError(error)],
      });
    }
    next(error);
  }
}

/** GET /pools/:id/editar */
async function formEditar(req, res, next) {
  try {
    const pool = await IpPool.findById(req.params.id);
    if (!pool) throw crearError(404, 'El pool no existe.');
    const routers = await Router.find({ active: true }).sort({ name: 1 }).lean();
    res.render('pools/form', {
      titulo: `Editar ${pool.name}`,
      pool,
      routers,
      modo: 'editar',
      errores: [],
      datos: analizarCidr(pool.cidr),
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /pools/:id */
async function actualizar(req, res, next) {
  try {
    const pool = await IpPool.findById(req.params.id);
    if (!pool) throw crearError(404, 'El pool no existe.');
    const datos = payloadPool(req.body);
    const cambiaAlcance = String(datos.cidr) !== String(pool.cidr)
      || String(datos.routerId || '') !== String(pool.routerId || '');
    if (cambiaAlcance) {
      const [servicios, ventas] = await Promise.all([
        Subscription.exists({ 'serviceConfig.ipPoolId': pool._id }),
        Sale.exists({ status: 'waiting', 'service.ipPoolId': pool._id }),
      ]);
      if (servicios || ventas) {
        req.flash('error', 'No puedes cambiar el CIDR ni el router de un pool con servicios o ventas pendientes.');
        return res.redirect(`/pools/${pool._id}/editar`);
      }
    }
    Object.assign(pool, datos);
    await pool.save();
    await registrar({
      module: 'provisioning',
      entity: 'IpPool',
      entityId: pool._id,
      action: 'update',
      description: `Pool ${pool.name} actualizado a ${pool.cidr}.`,
      changes: { after: { name: pool.name, cidr: pool.cidr } },
    });
    req.flash('exito', 'Pool actualizado.');
    res.redirect('/pools');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      const pool = await IpPool.findById(req.params.id);
      if (pool) Object.assign(pool, payloadPool(req.body));
      const { lista, campos } = normalizarErrores(error);
      const poolFinal = pool || new IpPool(payloadPool(req.body));
      return res.status(422).render('pools/form', {
        titulo: `Editar ${poolFinal.name || 'pool'}`,
        pool: poolFinal,
        routers: await Router.find({ active: true }).sort({ name: 1 }).lean(),
        errores: lista,
        erroresCampo: campos,
        modo: 'editar',
        datos: analizarCidr(poolFinal.cidr),
      });
    }
    next(error);
  }
}

/** POST /pools/:id/aplicar */
async function aplicar(req, res, next) {
  try {
    const pool = await IpPool.findById(req.params.id);
    if (!pool) throw crearError(404, 'El pool no existe.');
    const resultado = await routerService.aplicarPool(pool);
    if (resultado.ok) {
      req.flash('exito', `Pool ${pool.name} aplicado en ${resultado.router?.name || 'el router'}${resultado.simulado ? ' (simulado)' : ''}.`);
    } else {
      req.flash('error', 'No se pudo aplicar el pool. Revisa la auditoría.');
    }
    res.redirect('/pools');
  } catch (error) {
    next(error);
  }
}

/** DELETE /pools/:id */
async function eliminar(req, res, next) {
  try {
    const pool = await IpPool.findById(req.params.id);
    if (!pool) throw crearError(404, 'El pool no existe.');
    const usos = await Subscription.countDocuments({ 'serviceConfig.ipPoolId': pool._id });
    const ventas = await Sale.countDocuments({ status: 'waiting', 'service.ipPoolId': pool._id });
    if (usos || ventas) {
      req.flash('error', `No se puede eliminar ${pool.name}: ${usos} servicio(s) y ${ventas} venta(s) en espera usan sus direcciones.`);
      return res.redirect('/pools');
    }
    await pool.deleteOne();
    await registrar({
      module: 'provisioning',
      entity: 'IpPool',
      entityId: pool._id,
      action: 'delete',
      description: `Pool ${pool.name} eliminado.`,
      changes: { before: { name: pool.name, cidr: pool.cidr } },
    });
    req.flash('exito', 'Pool eliminado.');
    res.redirect('/pools');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, aplicar, eliminar };
