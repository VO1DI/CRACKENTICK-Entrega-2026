const Zone = require('../models/Zone');
const FaultReport = require('../models/FaultReport');
const InstallationReport = require('../models/InstallationReport');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');

function payloadZona(body = {}) {
  return {
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    active: body.active === 'on' || body.active === 'true',
    order: Number(body.order) || 0,
  };
}

/** GET /red/zonas */
async function index(req, res, next) {
  try {
    const [zonas, averias, instalaciones] = await Promise.all([
      Zone.find().sort({ active: -1, order: 1, name: 1 }).lean(),
      FaultReport.aggregate([{ $group: { _id: '$zoneId', total: { $sum: 1 } } }]),
      InstallationReport.aggregate([{ $group: { _id: '$zoneId', total: { $sum: 1 } } }]),
    ]);
    const mapaAverias = new Map(averias.map((f) => [String(f._id), f.total]));
    const mapaInstalaciones = new Map(instalaciones.map((f) => [String(f._id), f.total]));

    res.render('zones/index', {
      titulo: 'Zonas',
      zonas: zonas.map((zona) => ({
        ...zona,
        averias: mapaAverias.get(String(zona._id)) || 0,
        instalaciones: mapaInstalaciones.get(String(zona._id)) || 0,
      })),
      errores: [],
      erroresCampo: {},
      valores: {},
    });
  } catch (error) {
    next(error);
  }
}

/** GET /red/zonas/:id/editar */
async function formEditar(req, res, next) {
  try {
    const zona = await Zone.findById(req.params.id);
    if (!zona) throw crearError(404, 'La zona no existe.');
    res.render('zones/form', { titulo: `Editar ${zona.name}`, zona, errores: [], erroresCampo: {} });
  } catch (error) {
    next(error);
  }
}

/** POST /red/zonas */
async function crear(req, res, next) {
  try {
    const zona = new Zone(payloadZona(req.body));
    await zona.save();
    await registrar({
      module: 'technical',
      entity: 'Zone',
      entityId: zona._id,
      action: 'create',
      description: `Zona ${zona.name} creada.`,
      changes: { after: { name: zona.name, active: zona.active } },
    });
    req.flash('exito', `Zona ${zona.name} creada.`);
    res.redirect('/red/zonas');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      const { lista, campos } = normalizarErrores(error);
      const zonas = await Zone.find().sort({ active: -1, name: 1 }).lean();
      return res.status(422).render('zones/index', {
        titulo: 'Zonas',
        zonas: zonas.map((zona) => ({ ...zona, averias: 0, instalaciones: 0 })),
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

/** PUT /red/zonas/:id */
async function actualizar(req, res, next) {
  try {
    const zona = await Zone.findById(req.params.id);
    if (!zona) throw crearError(404, 'La zona no existe.');
    const antes = { name: zona.name, active: zona.active };
    Object.assign(zona, payloadZona(req.body));
    await zona.save();
    await registrar({
      module: 'technical',
      entity: 'Zone',
      entityId: zona._id,
      action: 'update',
      description: `Zona ${zona.name} actualizada.`,
      changes: { before: antes, after: { name: zona.name, active: zona.active } },
    });
    req.flash('exito', `Zona ${zona.name} actualizada.`);
    res.redirect('/red/zonas');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      const zona = await Zone.findById(req.params.id);
      if (zona) Object.assign(zona, payloadZona(req.body));
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('zones/form', {
        titulo: `Editar ${zona?.name || 'zona'}`,
        zona: zona || new Zone(payloadZona(req.body)),
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** DELETE /red/zonas/:id */
async function eliminar(req, res, next) {
  try {
    const zona = await Zone.findById(req.params.id);
    if (!zona) throw crearError(404, 'La zona no existe.');
    const [averias, instalaciones] = await Promise.all([
      FaultReport.countDocuments({ zoneId: zona._id }),
      InstallationReport.countDocuments({ zoneId: zona._id }),
    ]);
    if (averias || instalaciones) {
      req.flash('error', `No puedes eliminar ${zona.name}: tiene ${averias} avería(s) y ${instalaciones} instalación(es). Desactívala en su lugar.`);
      return res.redirect('/red/zonas');
    }
    await zona.deleteOne();
    await registrar({
      module: 'technical',
      entity: 'Zone',
      entityId: zona._id,
      action: 'delete',
      description: `Zona ${zona.name} eliminada.`,
      changes: { before: { name: zona.name } },
    });
    req.flash('exito', `Zona ${zona.name} eliminada.`);
    res.redirect('/red/zonas');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formEditar, crear, actualizar, eliminar };
