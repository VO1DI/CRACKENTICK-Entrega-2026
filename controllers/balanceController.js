const mongoose = require('mongoose');
const BalanceConfig = require('../models/BalanceConfig');
const Router = require('../models/Router');
const balanceService = require('../services/balanceService');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');

async function routersConConteo() {
  const [routers, configs] = await Promise.all([
    Router.find().sort({ active: -1, name: 1 }).lean(),
    BalanceConfig.find().select('routerId').lean(),
  ]);
  return {
    routers,
    conteos: Object.fromEntries(configs.map((config) => [String(config.routerId), 1])),
  };
}

function leerEntradas(body = {}) {
  const nombres = [].concat(body.wanName || []);
  const gateways = [].concat(body.wanGateway || []);
  const interfaces = [].concat(body.wanInterface || []);
  return gateways
    .map((gateway, indice) => ({
      name: String(nombres[indice] || '').trim(),
      gateway: String(gateway || '').trim(),
      interface: String(interfaces[indice] || '').trim(),
      enabled: true,
    }))
    .filter((entrada) => entrada.gateway);
}

async function index(req, res, next) {
  try {
    const { routers, conteos } = await routersConConteo();
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : '';
    const selectedRouter = routerId ? routers.find((router) => String(router._id) === String(routerId)) : null;
    const config = selectedRouter ? await BalanceConfig.findOne({ routerId: selectedRouter._id }).lean() : null;
    res.render('network/balance-index', {
      titulo: 'Balanceo de WAN',
      routers,
      conteos,
      selectedRouter,
      balanceConfig: config,
      modulo: 'balanceo',
      errores: [],
      erroresCampo: {},
      valores: null,
    });
  } catch (error) {
    next(error);
  }
}

async function guardar(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.body.routerId)) throw crearError(422, 'Selecciona un router.');
    const router = await Router.findById(req.body.routerId).select('+passwordEnc +enablePasswordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    const entradas = leerEntradas(req.body);
    const metodo = req.body.method === 'ecmp' || router.vendor === 'cisco' ? 'ecmp' : 'pcc';
    const lanInterface = String(req.body.lanInterface || '').trim();
    if (metodo === 'pcc' && router.hotspotEnabled) {
      throw crearError(422, 'PCC no es compatible con HotSpot: el proxy usa solo la tabla principal. Usa ECMP en este router.');
    }

    let config = await BalanceConfig.findOne({ routerId: router._id });
    const anteriores = config ? config.entries.map((entrada) => ({ gateway: entrada.gateway })) : [];
    if (!config) config = new BalanceConfig({ routerId: router._id });
    config.method = metodo;
    config.lanInterface = lanInterface;
    config.entries = entradas;
    config.enabled = true;
    balanceService.validarBalanceo(config);

    const resultado = await balanceService.aplicar(router, config, 'crear', { anteriores });
    if (!resultado.ok) {
      return res.status(502).render('network/balance-index', {
        titulo: 'Balanceo de WAN',
        routers: await Router.find().sort({ active: -1, name: 1 }).lean(),
        conteos: (await routersConConteo()).conteos,
        selectedRouter: router,
        balanceConfig: config,
        modulo: 'balanceo',
        errores: [`El router rechazó el balanceo; no se guardó la configuración. ${resultado.salida}`],
        erroresCampo: {},
        valores: { entries: entradas, method: metodo, lanInterface },
      });
    }

    config.status = resultado.simulado ? 'simulated' : 'applied';
    config.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : '';
    config.appliedAt = new Date();
    await config.save();

    req.flash('exito', resultado.simulado ? 'Balanceo guardado en modo simulado.' : `Balanceo ${metodo.toUpperCase()} aplicado en el router.`);
    res.redirect(`/red/balanceo?routerId=${router._id}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const { lista, campos } = normalizarErrores(error);
      const { routers, conteos } = await routersConConteo();
      const selectedRouter = mongoose.isValidObjectId(req.body.routerId)
        ? routers.find((router) => String(router._id) === String(req.body.routerId))
        : null;
      return res.status(error.status || 422).render('network/balance-index', {
        titulo: 'Balanceo de WAN',
        routers,
        conteos,
        selectedRouter,
        balanceConfig: null,
        modulo: 'balanceo',
        errores: lista,
        erroresCampo: campos,
        valores: { entries: leerEntradas(req.body) },
      });
    }
    next(error);
  }
}

async function quitar(req, res, next) {
  try {
    const config = await BalanceConfig.findById(req.params.id);
    if (!config) throw crearError(404, 'El balanceo no existe.');
    const router = await Router.findById(config.routerId).select('+passwordEnc +enablePasswordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    const anteriores = config.entries.map((entrada) => ({ gateway: entrada.gateway }));
    const resultado = await balanceService.aplicar(router, config, 'eliminar', { anteriores });
    if (!resultado.ok) {
      config.status = 'error';
      config.lastResult = resultado.salida ? resultado.salida.slice(0, 500) : 'El router rechazó la eliminación.';
      await config.save();
      req.flash('error', `No se pudo quitar el balanceo: ${config.lastResult}`);
      return res.redirect(`/red/balanceo?routerId=${router._id}`);
    }
    await config.deleteOne();
    await registrar({
      module: 'provisioning',
      entity: 'BalanceConfig',
      entityId: config._id,
      action: 'delete',
      description: `Balanceo eliminado de ${router.name}.`,
      changes: { before: { wan: anteriores.length } },
    });
    req.flash('exito', resultado.simulado ? 'Balanceo eliminado del registro simulado.' : 'Balanceo eliminado del router.');
    res.redirect(`/red/balanceo?routerId=${router._id}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, guardar, quitar };
