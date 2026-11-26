const mongoose = require('mongoose');
const Router = require('../models/Router');

/** GET /red/experimental: índice de funciones avanzadas no probadas de punta a punta. */
async function index(req, res, next) {
  try {
    const routers = await Router.find().sort({ active: -1, name: 1 }).lean();
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : '';
    const selectedRouter = routerId ? routers.find((router) => String(router._id) === String(routerId)) : null;
    res.render('network/experimental', {
      titulo: 'Experimental',
      routers,
      selectedRouter,
      modulo: 'experimental',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index };
