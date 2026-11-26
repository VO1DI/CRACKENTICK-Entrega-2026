const mongoose = require('mongoose');
const Router = require('../models/Router');
const HotspotPlan = require('../models/HotspotPlan');
const HotspotVoucher = require('../models/HotspotVoucher');
const HotspotBatch = require('../models/HotspotBatch');
const hotspotService = require('../services/hotspotService');
const { crearError } = require('../utils/errors');

async function index(req, res, next) {
  try {
    const routers = await Router.find({ active: true, vendor: 'mikrotik' })
      .sort({ name: 1 })
      .select('name host hotspotEnabled hotspotServer hotspotProfile')
      .lean();
    const routerId = mongoose.isValidObjectId(req.query.routerId) ? req.query.routerId : routers[0]?._id || '';
    const router = routerId ? await Router.findById(routerId).select('+passwordEnc') : null;

    let deteccion = { servidores: [], perfiles: [] };
    let errorDeteccion = '';
    if (router) {
      try {
        deteccion = await hotspotService.detectar(router);
      } catch (error) {
        errorDeteccion = error.message;
      }
    }

    const filtro = router ? { routerId: router._id } : { routerId: null };
    const [vouchers, lotes, planes, disponibles, vendidos, revocados, recaudado] = await Promise.all([
      HotspotVoucher.find(filtro).sort({ createdAt: -1 }).limit(150).lean(),
      HotspotBatch.find(filtro).sort({ createdAt: -1 }).limit(12).lean(),
      HotspotPlan.find({ active: true }).sort({ price: 1 }).lean(),
      HotspotVoucher.countDocuments({ ...filtro, status: 'available' }),
      HotspotVoucher.countDocuments({ ...filtro, status: 'sold' }),
      HotspotVoucher.countDocuments({ ...filtro, status: 'revoked' }),
      HotspotVoucher.aggregate([
        { $match: { ...filtro, status: 'sold' } },
        { $group: { _id: null, total: { $sum: { $cond: [{ $gt: ['$amountUsd', 0] }, '$amountUsd', '$price'] } } } },
      ]),
    ]);

    res.render('hotspot/index', {
      titulo: 'Hotspot y vouchers',
      routers,
      router,
      deteccion,
      errorDeteccion,
      vouchers,
      lotes,
      planes,
      resumen: { disponibles, vendidos, revocados, recaudado: recaudado[0]?.total || 0 },
    });
  } catch (error) {
    next(error);
  }
}

async function guardarConfig(req, res, next) {
  try {
    const router = await Router.findById(req.params.id);
    if (!router) throw crearError(404, 'El router no existe.');
    router.hotspotEnabled = req.body.enabled === 'on';
    router.hotspotServer = String(req.body.server || '').trim().slice(0, 60);
    router.hotspotProfile = String(req.body.profile || '').trim().slice(0, 60);
    await router.save();
    req.flash('exito', req.body.enabled === 'on' ? 'Router habilitado para hotspot.' : 'Hotspot deshabilitado en este router.');
    res.redirect(`/hotspot?routerId=${router._id}`);
  } catch (error) {
    req.flash('error', error.message);
    res.redirect('/hotspot');
  }
}

async function crearLote(req, res, next) {
  try {
    const router = await Router.findById(req.body.routerId).select('+passwordEnc');
    if (!router) throw crearError(404, 'El router no existe.');
    const resultado = await hotspotService.crearLote({
      router,
      planId: req.body.planId,
      cantidad: req.body.quantity,
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    const fallos = resultado.errores.length;
    req.flash(
      fallos ? 'error' : 'exito',
      `Lote ${resultado.lote.status === 'incomplete' ? 'incompleto' : 'creado'}: ${resultado.vouchers.length}/${resultado.lote.quantity} voucher(s).${fallos ? ` Fallaron ${fallos}.` : ''}`
    );
    res.redirect(`/hotspot?routerId=${router._id}`);
  } catch (error) {
    req.flash('error', error.message);
    res.redirect(`/hotspot?routerId=${req.body.routerId || ''}`);
  }
}

async function vender(req, res, next) {
  try {
    const voucher = await HotspotVoucher.findById(req.params.id);
    if (!voucher) throw crearError(404, 'El voucher no existe.');
    const router = await Router.findById(voucher.routerId).select('+passwordEnc');
    if (!router) throw crearError(404, 'El router del voucher no existe.');
    const resultado = await hotspotService.vender(voucher, router, {
      actor: req.usuario ? req.usuario.username : 'admin',
      paymentMethod: req.body.paymentMethod || 'cash',
      currency: req.body.paymentCurrency || 'USD',
      amount: req.body.paymentAmount,
      reference: req.body.paymentReference,
    });
    req.flash(
      'exito',
      `Voucher ${resultado.voucher.code} vendido por ${resultado.voucher.paymentAmount} ${resultado.voucher.paymentCurrency}.`
    );
    res.redirect(`/hotspot?routerId=${voucher.routerId}`);
  } catch (error) {
    req.flash('error', error.message);
    res.redirect(`/hotspot?routerId=${req.body.routerId || ''}`);
  }
}

async function revocar(req, res, next) {
  try {
    const voucher = await HotspotVoucher.findById(req.params.id);
    if (!voucher) throw crearError(404, 'El voucher no existe.');
    const router = await Router.findById(voucher.routerId).select('+passwordEnc');
    if (!router) throw crearError(404, 'El router del voucher no existe.');
    await hotspotService.revocar(voucher, router, { actor: req.usuario ? req.usuario.username : 'admin' });
    req.flash('exito', `Voucher ${voucher.code} revocado.`);
    res.redirect(`/hotspot?routerId=${voucher.routerId}`);
  } catch (error) {
    req.flash('error', error.message);
    res.redirect(`/hotspot?routerId=${req.body.routerId || ''}`);
  }
}

async function imprimirLote(req, res, next) {
  try {
    const lote = await HotspotBatch.findById(req.params.id).lean();
    if (!lote) throw crearError(404, 'El lote no existe.');
    const vouchers = await HotspotVoucher.find({ batchId: lote._id }).sort({ code: 1 }).lean();
    res.render('hotspot/imprimir', { layout: false, lote, vouchers, minutosTexto: hotspotService.minutosTexto });
  } catch (error) {
    next(error);
  }
}

/* ------------------------------ Planes ------------------------------ */

async function planes(req, res, next) {
  try {
    const lista = await HotspotPlan.find({}).sort({ price: 1 }).lean();
    const batches = await HotspotBatch.aggregate([
      { $match: { planId: { $ne: null } } },
      { $group: { _id: '$planId', lotes: { $sum: 1 }, vouchers: { $sum: '$quantity' } } },
    ]);
    const conteo = new Map(batches.map((fila) => [String(fila._id), fila]));
    res.render('hotspot/planes', { titulo: 'Planes de hotspot', planes: lista, conteo });
  } catch (error) {
    next(error);
  }
}

async function crearPlan(req, res, next) {
  try {
    const nombre = String(req.body.name || '').trim();
    if (!nombre) throw crearError(422, 'Escribe el nombre del plan.');
    await HotspotPlan.create({
      name: nombre,
      price: Math.max(0, Number(req.body.price) || 0),
      durationMinutes: Math.max(0, Number(req.body.durationMinutes) || 0),
      downloadMbps: Math.max(0, Number(req.body.downloadMbps) || 0),
      uploadMbps: Math.max(0, Number(req.body.uploadMbps) || 0),
      dataLimitMB: Math.max(0, Number(req.body.dataLimitMB) || 0),
      active: req.body.active !== 'off',
    });
    req.flash('exito', 'Plan de hotspot creado.');
    res.redirect('/hotspot/planes');
  } catch (error) {
    req.flash('error', error.code === 11000 ? 'Ya existe un plan con ese nombre.' : error.message);
    res.redirect('/hotspot/planes');
  }
}

async function estadoPlan(req, res, next) {
  try {
    const plan = await HotspotPlan.findById(req.params.id);
    if (!plan) throw crearError(404, 'El plan no existe.');
    plan.active = !plan.active;
    await plan.save();
    req.flash('exito', `Plan ${plan.name} ${plan.active ? 'activado' : 'desactivado'}.`);
    res.redirect('/hotspot/planes');
  } catch (error) {
    req.flash('error', error.message);
    res.redirect('/hotspot/planes');
  }
}

async function eliminarPlan(req, res, next) {
  try {
    const plan = await HotspotPlan.findById(req.params.id);
    if (!plan) throw crearError(404, 'El plan no existe.');
    await plan.deleteOne();
    req.flash('exito', 'Plan eliminado. Los vouchers ya creados se mantienen.');
    res.redirect('/hotspot/planes');
  } catch (error) {
    req.flash('error', error.message);
    res.redirect('/hotspot/planes');
  }
}

module.exports = {
  index,
  guardarConfig,
  crearLote,
  vender,
  revocar,
  imprimirLote,
  planes,
  crearPlan,
  estadoPlan,
  eliminarPlan,
};
