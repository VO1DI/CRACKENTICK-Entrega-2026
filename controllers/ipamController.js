const mongoose = require('mongoose');
const ipamService = require('../services/ipamService');
const { crearError } = require('../utils/errors');

async function index(req, res, next) {
  try {
    const datos = await ipamService.resumen();
    res.render('network/ipam', { titulo: 'IPAM', ...datos });
  } catch (error) {
    next(error);
  }
}

async function detalle(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw crearError(404, 'El pool no existe.');
    const datos = await ipamService.detalle(req.params.id);
    if (!datos) throw crearError(404, 'El pool no existe.');
    res.render('network/ipam-detalle', { titulo: `IPAM · ${datos.pool.name}`, ...datos });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/red/ipam');
    }
    next(error);
  }
}

module.exports = { index, detalle };
