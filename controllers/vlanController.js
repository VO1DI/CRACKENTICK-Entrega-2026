const mongoose = require('mongoose');
const Vlan = require('../models/Vlan');
const Router = require('../models/Router');
const vlanService = require('../services/vlanService');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');

function payloadVlan(body = {}) {
  return {
    routerId: body.routerId,
    vlanId: Number(body.vlanId),
    name: String(body.name || '').trim(),
    interface: String(body.interface || '').trim(),
    address: String(body.address || '').trim(),
    enabled: body.enabled !== 'off',
    notes: String(body.notes || '').trim(),
  };
}

async function cargarRouter(routerId) {
  if (!mongoose.isValidObjectId(routerId)) throw crearError(422, 'Selecciona un router válido.');
  const router = await Router.findById(routerId).select('+passwordEnc +enablePasswordEnc');
  if (!router) throw crearError(404, 'El router no existe.');
  return router;
}

async function listarRouters() {
  return Router.find({ active: true }).sort({ name: 1 }).lean();
}

/** GET /red/vlans */
async function index(req, res, next) {
  try {
    const [routers, filas] = await Promise.all([
      Router.find().sort({ active: -1, name: 1 }).lean(),
      Vlan.aggregate([{ $group: { _id: '$routerId', total: { $sum: 1 } } }]),
    ]);
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : '';
    const selectedRouter = routerId ? routers.find((router) => String(router._id) === String(routerId)) : null;
    const vlans = selectedRouter ? await Vlan.find({ routerId: selectedRouter._id }).sort({ vlanId: 1 }).lean() : [];
    res.render('vlans/index', {
      titulo: 'VLANs',
      routers,
      conteos: Object.fromEntries(filas.map((f) => [String(f._id), f.total])),
      selectedRouter,
      vlans,
      total: filas.reduce((suma, f) => suma + f.total, 0),
      modulo: 'vlans',
      errores: [],
      erroresCampo: {},
      valores: {},
    });
  } catch (error) {
    next(error);
  }
}

/** GET /red/vlans/nuevo */
async function formNuevo(req, res, next) {
  try {
    const routers = await listarRouters();
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : routers[0]?._id || null;
    res.render('vlans/form', {
      titulo: 'Nueva VLAN',
      vlan: new Vlan({ routerId, enabled: true }),
      routers,
      modo: 'crear',
      errores: [],
      erroresCampo: {},
    });
  } catch (error) {
    next(error);
  }
}

/** POST /red/vlans */
async function crear(req, res, next) {
  try {
    const router = await cargarRouter(req.body.routerId);
    const datos = payloadVlan(req.body);
    datos.routerId = router._id;
    vlanService.validarVlan(datos);

    const vlan = new Vlan(datos);
    const resultado = await vlanService.aplicar(router, vlan, 'crear');
    if (!resultado.ok) {
      const routers = await listarRouters();
      return res.status(502).render('vlans/form', {
        titulo: 'Nueva VLAN',
        vlan: new Vlan(datos),
        routers,
        modo: 'crear',
        errores: [
          `El router rechazó el cambio; no se guardó la VLAN.${resultado.revertido ? ' Se revirtieron los pasos aplicados.' : ''} ${resultado.salida}`,
        ],
        erroresCampo: {},
      });
    }
    vlan.status = resultado.simulado ? 'simulated' : 'applied';
    vlan.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : 'Registrada en modo simulado.';
    vlan.appliedAt = new Date();
    await vlan.save();

    req.flash('exito', resultado.simulado ? 'VLAN registrada en modo simulado.' : 'VLAN creada en el router.');
    res.redirect('/red/vlans');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const { lista, campos } = normalizarErrores(error);
      const routers = await listarRouters();
      return res.status(error.status || 422).render('vlans/form', {
        titulo: 'Nueva VLAN',
        vlan: new Vlan(payloadVlan(req.body)),
        routers,
        modo: 'crear',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** GET /red/vlans/:id/editar */
async function formEditar(req, res, next) {
  try {
    const vlan = await Vlan.findById(req.params.id).populate('routerId');
    if (!vlan) throw crearError(404, 'La VLAN no existe.');
    res.render('vlans/form', { titulo: `Editar VLAN ${vlan.vlanId}`, vlan, routers: [], modo: 'editar', errores: [], erroresCampo: {} });
  } catch (error) {
    next(error);
  }
}

/** PUT /red/vlans/:id */
async function actualizar(req, res, next) {
  try {
    const vlan = await Vlan.findById(req.params.id);
    if (!vlan) throw crearError(404, 'La VLAN no existe.');
    const router = await cargarRouter(vlan.routerId);
    const anterior = vlan.toObject();
    const datos = payloadVlan({ ...req.body, routerId: vlan.routerId, vlanId: vlan.vlanId });
    datos.enabled = vlan.enabled;
    vlanService.validarVlan(datos);
    Object.assign(vlan, datos);

    const resultado = await vlanService.aplicar(router, vlan, 'actualizar', { anterior });
    if (!resultado.ok) {
      Object.assign(vlan, anterior);
      return res.status(502).render('vlans/form', {
        titulo: `Editar VLAN ${vlan.vlanId}`,
        vlan,
        routers: [],
        modo: 'editar',
        errores: [
          `El router rechazó el cambio; no se guardó la VLAN.${resultado.revertido ? ' Se revirtieron los pasos aplicados.' : ''} ${resultado.salida}`,
        ],
        erroresCampo: {},
      });
    }

    vlan.status = resultado.simulado ? 'simulated' : 'applied';
    vlan.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : 'Actualizada en modo simulado.';
    vlan.appliedAt = new Date();
    await vlan.save();

    await registrar({
      module: 'provisioning',
      entity: 'Vlan',
      entityId: vlan._id,
      action: 'update',
      description: `VLAN ${vlan.name} (${vlan.vlanId}) actualizada en ${router.name}.`,
      changes: { after: { name: vlan.name, interface: vlan.interface, address: vlan.address } },
    });

    req.flash('exito', 'VLAN actualizada.');
    res.redirect('/red/vlans');
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const vlan = await Vlan.findById(req.params.id).populate('routerId');
      if (vlan) Object.assign(vlan, payloadVlan({ ...req.body, routerId: vlan.routerId, vlanId: vlan.vlanId }));
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('vlans/form', {
        titulo: `Editar VLAN ${vlan?.vlanId || ''}`,
        vlan: vlan || new Vlan(payloadVlan(req.body)),
        routers: [],
        modo: 'editar',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** POST /red/vlans/:id/estado */
async function cambiarEstado(req, res, next) {
  try {
    const vlan = await Vlan.findById(req.params.id);
    if (!vlan) throw crearError(404, 'La VLAN no existe.');
    const router = await cargarRouter(vlan.routerId);
    const habilitar = req.body.accion === 'habilitar';
    const resultado = await vlanService.aplicar(router, vlan, habilitar ? 'habilitar' : 'inhabilitar');
    if (!resultado.ok) {
      req.flash('error', `No se pudo cambiar la VLAN; el registro no se modificó. ${resultado.salida || ''}`);
      return res.redirect('/red/vlans');
    }
    vlan.enabled = habilitar;
    vlan.status = resultado.simulado ? 'simulated' : 'applied';
    vlan.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : (resultado.simulado ? 'Cambio simulado.' : '');
    vlan.appliedAt = new Date();
    await vlan.save();
    req.flash('exito', `VLAN ${habilitar ? 'habilitada' : 'inhabilitada'}.`);
    res.redirect('/red/vlans');
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/vlans');
    }
    next(error);
  }
}

/** DELETE /red/vlans/:id */
async function eliminar(req, res, next) {
  try {
    const vlan = await Vlan.findById(req.params.id);
    if (!vlan) throw crearError(404, 'La VLAN no existe.');
    const router = await cargarRouter(vlan.routerId);
    const resultado = await vlanService.aplicar(router, vlan, 'eliminar');
    if (!resultado.ok) {
      vlan.status = 'error';
      vlan.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : 'El router rechazó la eliminación.';
      await vlan.save();
      req.flash('error', `No se eliminó la VLAN en el router: ${vlan.lastResult}`);
      return res.redirect('/red/vlans');
    }
    await vlan.deleteOne();
    req.flash('exito', resultado.simulado ? 'VLAN eliminada del registro simulado.' : 'VLAN eliminada del router.');
    res.redirect('/red/vlans');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, cambiarEstado, eliminar };
