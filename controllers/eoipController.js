const mongoose = require('mongoose');
const EoipTunnel = require('../models/EoipTunnel');
const Router = require('../models/Router');
const routerConfigService = require('../services/routerConfigService');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');

async function routersConConteo() {
  const [routers, conteos] = await Promise.all([
    Router.find().sort({ active: -1, name: 1 }).lean(),
    EoipTunnel.aggregate([{ $group: { _id: '$routerId', total: { $sum: 1 } } }]),
  ]);
  return { routers, conteos: Object.fromEntries(conteos.map((f) => [String(f._id), f.total])) };
}

async function cargarRouter(routerId) {
  if (!mongoose.isValidObjectId(routerId)) throw crearError(422, 'Selecciona un router válido.');
  const router = await Router.findById(routerId).select('+passwordEnc +enablePasswordEnc');
  if (!router) throw crearError(404, 'El router no existe.');
  return router;
}

function payloadTunel(body = {}) {
  return {
    name: String(body.name || '').trim(),
    remoteAddress: String(body.remoteAddress || '').trim(),
    tunnelId: Number(body.tunnelId),
    localAddress: String(body.localAddress || '').trim(),
    notes: String(body.notes || '').trim(),
    enabled: body.enabled !== 'off',
  };
}

async function index(req, res, next) {
  try {
    const { routers, conteos } = await routersConConteo();
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : '';
    const selectedRouter = routerId ? routers.find((router) => String(router._id) === String(routerId)) : null;
    const tuneles = selectedRouter
      ? await EoipTunnel.find({ routerId: selectedRouter._id }).sort({ name: 1 }).lean()
      : [];
    res.render('network/eoip-index', {
      titulo: 'Túneles EOIP',
      routers,
      conteos,
      selectedRouter,
      tuneles,
      modulo: 'eoip',
    });
  } catch (error) {
    next(error);
  }
}

async function formNuevo(req, res, next) {
  try {
    const router = await cargarRouter(req.query.routerId);
    res.render('network/eoip-form', {
      titulo: 'Nuevo túnel EOIP',
      tunel: new EoipTunnel({ tunnelId: 1, enabled: true }),
      router,
      modo: 'crear',
      errores: [],
      erroresCampo: {},
    });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/eoip');
    }
    next(error);
  }
}

async function crear(req, res, next) {
  try {
    const router = await cargarRouter(req.body.routerId);
    const datos = payloadTunel(req.body);
    routerConfigService.validarEoip(datos);
    const tunel = new EoipTunnel({ ...datos, routerId: router._id });
    const resultado = await routerConfigService.aplicarEoip(router, tunel, 'crear');
    if (!resultado.ok) {
      return res.status(502).render('network/eoip-form', {
        titulo: 'Nuevo túnel EOIP',
        tunel,
        router,
        modo: 'crear',
        errores: [`El router rechazó el túnel; no se guardó. ${resultado.salida}`],
        erroresCampo: {},
      });
    }
    tunel.status = resultado.simulado ? 'simulated' : 'applied';
    tunel.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : 'Registrado en modo simulado.';
    tunel.appliedAt = new Date();
    await tunel.save();
    req.flash('exito', resultado.simulado ? 'Túnel registrado en modo simulado.' : 'Túnel EOIP aplicado.');
    res.redirect(`/red/eoip?routerId=${router._id}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const router = await Router.findById(req.body.routerId).select('+passwordEnc +enablePasswordEnc').catch(() => null);
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('network/eoip-form', {
        titulo: 'Nuevo túnel EOIP',
        tunel: new EoipTunnel(payloadTunel(req.body)),
        router: router || new Router({ name: 'Router' }),
        modo: 'crear',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

async function formEditar(req, res, next) {
  try {
    const tunel = await EoipTunnel.findById(req.params.id).populate('routerId');
    if (!tunel) throw crearError(404, 'El túnel no existe.');
    res.render('network/eoip-form', {
      titulo: 'Editar túnel EOIP',
      tunel,
      router: tunel.routerId,
      modo: 'editar',
      errores: [],
      erroresCampo: {},
    });
  } catch (error) {
    next(error);
  }
}

async function actualizar(req, res, next) {
  try {
    const tunel = await EoipTunnel.findById(req.params.id);
    if (!tunel) throw crearError(404, 'El túnel no existe.');
    const router = await cargarRouter(tunel.routerId);
    const anterior = tunel.toObject();
    const datos = payloadTunel(req.body);
    datos.name = tunel.name;
    Object.assign(tunel, datos);
    routerConfigService.validarEoip(tunel);
    const resultado = await routerConfigService.aplicarEoip(router, tunel, 'actualizar');
    if (!resultado.ok) {
      Object.assign(tunel, anterior);
      return res.status(502).render('network/eoip-form', {
        titulo: 'Editar túnel EOIP',
        tunel,
        router,
        modo: 'editar',
        errores: [`El router rechazó el cambio; no se guardó. ${resultado.salida}`],
        erroresCampo: {},
      });
    }
    tunel.status = resultado.simulado ? 'simulated' : 'applied';
    tunel.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : '';
    tunel.appliedAt = new Date();
    await tunel.save();
    await registrar({
      module: 'provisioning',
      entity: 'EoipTunnel',
      entityId: tunel._id,
      action: 'update',
      description: `Túnel EOIP ${tunel.name} actualizado en ${router.name}.`,
      changes: { after: { remoteAddress: tunel.remoteAddress, tunnelId: tunel.tunnelId, enabled: tunel.enabled } },
    });
    req.flash('exito', 'Túnel actualizado.');
    res.redirect(`/red/eoip?routerId=${router._id}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const tunel = await EoipTunnel.findById(req.params.id).populate('routerId');
      if (tunel) Object.assign(tunel, payloadTunel(req.body));
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('network/eoip-form', {
        titulo: 'Editar túnel EOIP',
        tunel: tunel || new EoipTunnel(payloadTunel(req.body)),
        router: tunel?.routerId || new Router({ name: 'Router' }),
        modo: 'editar',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

async function cambiarEstado(req, res, next) {
  try {
    const tunel = await EoipTunnel.findById(req.params.id);
    if (!tunel) throw crearError(404, 'El túnel no existe.');
    const router = await cargarRouter(tunel.routerId);
    const habilitar = req.body.accion === 'habilitar';
    const resultado = await routerConfigService.aplicarEoip(router, tunel, habilitar ? 'habilitar' : 'inhabilitar');
    if (!resultado.ok) {
      req.flash('error', `No se pudo cambiar el túnel; el registro no se modificó. ${resultado.salida || ''}`);
      return res.redirect(`/red/eoip?routerId=${router._id}`);
    }
    tunel.enabled = habilitar;
    tunel.status = resultado.simulado ? 'simulated' : 'applied';
    tunel.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : '';
    tunel.appliedAt = new Date();
    await tunel.save();
    req.flash('exito', `Túnel ${habilitar ? 'habilitado' : 'inhabilitado'}.`);
    res.redirect(`/red/eoip?routerId=${router._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/eoip');
    }
    next(error);
  }
}

async function eliminar(req, res, next) {
  try {
    const tunel = await EoipTunnel.findById(req.params.id);
    if (!tunel) throw crearError(404, 'El túnel no existe.');
    const router = await cargarRouter(tunel.routerId);
    const resultado = await routerConfigService.aplicarEoip(router, tunel, 'eliminar');
    if (!resultado.ok) {
      tunel.status = 'error';
      tunel.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : 'El router rechazó la eliminación.';
      await tunel.save();
      req.flash('error', `No se eliminó el túnel en el router: ${tunel.lastResult}`);
      return res.redirect(`/red/eoip?routerId=${router._id}`);
    }
    await tunel.deleteOne();
    req.flash('exito', resultado.simulado ? 'Túnel eliminado del registro simulado.' : 'Túnel eliminado del router.');
    res.redirect(`/red/eoip?routerId=${router._id}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, cambiarEstado, eliminar };
