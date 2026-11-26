const mongoose = require('mongoose');
const Router = require('../models/Router');
const dhcpServerService = require('../services/dhcpServerService');
const { crearError } = require('../utils/errors');

async function cargarRouter(routerId) {
  if (!mongoose.isValidObjectId(routerId)) throw crearError(422, 'Selecciona un router válido.');
  const router = await Router.findById(routerId).select('+passwordEnc +enablePasswordEnc');
  if (!router) throw crearError(404, 'El router no existe.');
  return router;
}

/** GET /red/dhcp */
async function index(req, res, next) {
  try {
    const routers = await Router.find({ active: true }).sort({ name: 1 }).lean();
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : routers[0]?._id || '';
    const selectedRouter = routers.find((router) => String(router._id) === String(routerId)) || null;
    let datos = { interfaces: [], servidores: [], pools: [], redes: [] };
    let errorConexion = '';

    if (selectedRouter) {
      try {
        const router = await Router.findById(selectedRouter._id).select('+passwordEnc');
        datos = await dhcpServerService.listar(router);
      } catch (error) {
        errorConexion = error.message;
      }
    }

    res.render('network/dhcp', {
      titulo: 'Servidores DHCP',
      routers,
      selectedRouter,
      datos,
      errorConexion,
      leases: dhcpServerService.LEASES,
      dnsPorDefecto: dhcpServerService.DNS_POR_DEFECTO,
      valores: {},
    });
  } catch (error) {
    next(error);
  }
}

/** POST /red/dhcp */
async function crear(req, res, next) {
  try {
    const router = await cargarRouter(req.body.routerId);
    const resultado = await dhcpServerService.crear(router, req.body, {
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    if (!resultado.ok) throw crearError(502, 'El router no confirmó la creación del DHCP.');
    req.flash('exito', `Servidor DHCP ${resultado.name} creado en ${router.name} (${resultado.cidr}, ${resultado.range}).`);
    res.redirect(`/red/dhcp?routerId=${router._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect(`/red/dhcp?routerId=${req.body.routerId || ''}`);
    }
    next(error);
  }
}

module.exports = { index, crear };
