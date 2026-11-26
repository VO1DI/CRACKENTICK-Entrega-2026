const mongoose = require('mongoose');
const FirewallRule = require('../models/FirewallRule');
const Router = require('../models/Router');
const routerConfigService = require('../services/routerConfigService');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');

async function routersConConteo() {
  const [routers, conteos] = await Promise.all([
    Router.find().sort({ active: -1, name: 1 }).lean(),
    FirewallRule.aggregate([{ $group: { _id: '$routerId', total: { $sum: 1 } } }]),
  ]);
  return { routers, conteos: Object.fromEntries(conteos.map((f) => [String(f._id), f.total])) };
}

async function cargarRouter(routerId) {
  if (!mongoose.isValidObjectId(routerId)) throw crearError(422, 'Selecciona un router válido.');
  const router = await Router.findById(routerId).select('+passwordEnc +enablePasswordEnc');
  if (!router) throw crearError(404, 'El router no existe.');
  return router;
}

function payloadRegla(body = {}) {
  return {
    chain: body.chain === 'input' ? 'input' : 'forward',
    action: ['accept', 'drop', 'reject'].includes(body.action) ? body.action : 'drop',
    protocol: ['tcp', 'udp', 'icmp'].includes(body.protocol) ? body.protocol : '',
    port: body.port ? Number(body.port) : null,
    srcAddress: String(body.srcAddress || '').trim(),
    comment: String(body.comment || '').trim(),
    enabled: body.enabled !== 'off',
  };
}

async function index(req, res, next) {
  try {
    const { routers, conteos } = await routersConConteo();
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : '';
    const selectedRouter = routerId ? routers.find((router) => String(router._id) === String(routerId)) : null;
    const reglas = selectedRouter
      ? await FirewallRule.find({ routerId: selectedRouter._id }).sort({ chain: 1, createdAt: -1 }).lean()
      : [];
    res.render('network/firewall-index', {
      titulo: 'Firewall de routers',
      routers,
      conteos,
      selectedRouter,
      reglas,
      modulo: 'firewall',
    });
  } catch (error) {
    next(error);
  }
}

async function formNuevo(req, res, next) {
  try {
    const router = await cargarRouter(req.query.routerId);
    res.render('network/firewall-form', {
      titulo: 'Nueva regla de firewall',
      regla: new FirewallRule({ chain: 'forward', action: 'drop', enabled: true }),
      router,
      modo: 'crear',
      errores: [],
      erroresCampo: {},
    });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/firewall');
    }
    next(error);
  }
}

async function crear(req, res, next) {
  try {
    const router = await cargarRouter(req.body.routerId);
    const datos = payloadRegla(req.body);
    routerConfigService.validarFirewall(datos);
    const regla = new FirewallRule({ ...datos, routerId: router._id });
    const resultado = await routerConfigService.aplicarFirewall(router, regla, 'crear');
    if (!resultado.ok) {
      return res.status(502).render('network/firewall-form', {
        titulo: 'Nueva regla de firewall',
        regla,
        router,
        modo: 'crear',
        errores: [`El router rechazó la regla; no se guardó. ${resultado.salida}`],
        erroresCampo: {},
      });
    }
    regla.status = resultado.simulado ? 'simulated' : 'applied';
    regla.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : 'Registrada en modo simulado.';
    regla.appliedAt = new Date();
    await regla.save();
    req.flash('exito', resultado.simulado ? 'Regla registrada en modo simulado.' : 'Regla aplicada en el router.');
    res.redirect(`/red/firewall?routerId=${router._id}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const router = await Router.findById(req.body.routerId).select('+passwordEnc +enablePasswordEnc').catch(() => null);
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('network/firewall-form', {
        titulo: 'Nueva regla de firewall',
        regla: new FirewallRule(payloadRegla(req.body)),
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
    const regla = await FirewallRule.findById(req.params.id).populate('routerId');
    if (!regla) throw crearError(404, 'La regla no existe.');
    res.render('network/firewall-form', {
      titulo: 'Editar regla de firewall',
      regla,
      router: regla.routerId,
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
    const regla = await FirewallRule.findById(req.params.id);
    if (!regla) throw crearError(404, 'La regla no existe.');
    const router = await cargarRouter(regla.routerId);
    const anterior = regla.toObject();
    Object.assign(regla, payloadRegla(req.body));
    routerConfigService.validarFirewall(regla);
    const resultado = await routerConfigService.aplicarFirewall(router, regla, 'actualizar');
    if (!resultado.ok) {
      Object.assign(regla, anterior);
      return res.status(502).render('network/firewall-form', {
        titulo: 'Editar regla de firewall',
        regla,
        router,
        modo: 'editar',
        errores: [`El router rechazó el cambio; no se guardó. ${resultado.salida}`],
        erroresCampo: {},
      });
    }
    regla.status = resultado.simulado ? 'simulated' : 'applied';
    regla.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : '';
    regla.appliedAt = new Date();
    await regla.save();
    await registrar({
      module: 'provisioning',
      entity: 'FirewallRule',
      entityId: regla._id,
      action: 'update',
      description: `Regla firewall ${regla.comment || regla._id} actualizada en ${router.name}.`,
      changes: { after: { chain: regla.chain, action: regla.action, enabled: regla.enabled } },
    });
    req.flash('exito', 'Regla actualizada.');
    res.redirect(`/red/firewall?routerId=${router._id}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const regla = await FirewallRule.findById(req.params.id).populate('routerId');
      if (regla) Object.assign(regla, payloadRegla(req.body));
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('network/firewall-form', {
        titulo: 'Editar regla de firewall',
        regla: regla || new FirewallRule(payloadRegla(req.body)),
        router: regla?.routerId || new Router({ name: 'Router' }),
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
    const regla = await FirewallRule.findById(req.params.id);
    if (!regla) throw crearError(404, 'La regla no existe.');
    const router = await cargarRouter(regla.routerId);
    const habilitar = req.body.accion === 'habilitar';
    const resultado = await routerConfigService.aplicarFirewall(router, regla, habilitar ? 'habilitar' : 'inhabilitar');
    if (!resultado.ok) {
      req.flash('error', `No se pudo cambiar la regla; el registro no se modificó. ${resultado.salida || ''}`);
      return res.redirect(`/red/firewall?routerId=${router._id}`);
    }
    regla.enabled = habilitar;
    regla.status = resultado.simulado ? 'simulated' : 'applied';
    regla.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : '';
    regla.appliedAt = new Date();
    await regla.save();
    req.flash('exito', `Regla ${habilitar ? 'habilitada' : 'inhabilitada'}.`);
    res.redirect(`/red/firewall?routerId=${router._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/firewall');
    }
    next(error);
  }
}

async function eliminar(req, res, next) {
  try {
    const regla = await FirewallRule.findById(req.params.id);
    if (!regla) throw crearError(404, 'La regla no existe.');
    const router = await cargarRouter(regla.routerId);
    const resultado = await routerConfigService.aplicarFirewall(router, regla, 'eliminar');
    if (!resultado.ok) {
      regla.status = 'error';
      regla.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : 'El router rechazó la eliminación.';
      await regla.save();
      req.flash('error', `No se eliminó la regla en el router: ${regla.lastResult}`);
      return res.redirect(`/red/firewall?routerId=${router._id}`);
    }
    await regla.deleteOne();
    req.flash('exito', resultado.simulado ? 'Regla eliminada del registro simulado.' : 'Regla eliminada del router.');
    res.redirect(`/red/firewall?routerId=${router._id}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, cambiarEstado, eliminar };
