const TaskType = require('../models/TaskType');
const WorkTask = require('../models/WorkTask');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');

function claveDe(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'tipo';
}

async function claveUnica(base, excluirId = null) {
  let clave = base;
  let intento = 1;
  while (await TaskType.exists({ key: clave, ...(excluirId ? { _id: { $ne: excluirId } } : {}) })) {
    intento += 1;
    clave = `${base}_${intento}`;
  }
  return clave;
}

function payloadTipo(body = {}) {
  return {
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    color: String(body.color || '#94a3b8').trim().toLowerCase(),
    order: Math.min(999, Math.max(0, Number(body.order) || 0)),
    active: body.active === 'on' || body.active === 'true',
  };
}

function erroresDe(error) {
  if (error.name === 'ValidationError') return Object.values(error.errors).map((detalle) => detalle.message);
  return [error.message || 'No se pudo guardar el tipo de tarea.'];
}

async function renderizarFormulario(req, res, { tipo, errores, status = 422 }) {
  return res.status(status).render('agenda/tipos-form', {
    titulo: tipo._id ? 'Editar tipo de tarea' : 'Nuevo tipo de tarea',
    tipo,
    modo: tipo._id ? 'editar' : 'crear',
    errores,
  });
}

/** GET /agenda/tipos */
async function index(req, res, next) {
  try {
    const [tipos, usos] = await Promise.all([
      TaskType.find().sort({ order: 1, name: 1 }).lean(),
      WorkTask.aggregate([{ $group: { _id: '$category', total: { $sum: 1 } } }]),
    ]);
    const conteo = new Map(usos.map((fila) => [fila._id, fila.total]));
    res.render('agenda/tipos', {
      titulo: 'Tipos de tarea',
      tipos: tipos.map((tipo) => ({ ...tipo, usos: conteo.get(tipo.key) || 0 })),
    });
  } catch (error) {
    next(error);
  }
}

/** GET /agenda/tipos/nuevo */
function formNuevo(req, res) {
  res.render('agenda/tipos-form', {
    titulo: 'Nuevo tipo de tarea',
    tipo: { name: '', description: '', color: '#94a3b8', order: 70, active: true },
    modo: 'crear',
    errores: [],
  });
}

/** POST /agenda/tipos */
async function crear(req, res, next) {
  try {
    const datos = payloadTipo(req.body);
    const errores = [];
    if (!datos.name || datos.name.length < 2) errores.push('El nombre debe tener al menos 2 caracteres.');
    if (datos.name.length > 60) errores.push('El nombre no puede superar 60 caracteres.');
    if (!/^#[0-9a-f]{6}$/.test(datos.color)) errores.push('El color debe tener el formato #RRGGBB.');
    if (errores.length) {
      return renderizarFormulario(req, res, { tipo: { ...datos, _id: null }, errores });
    }
    datos.key = await claveUnica(claveDe(datos.name));
    const tipo = await TaskType.create(datos);
    await registrar({
      module: 'agenda',
      entity: 'TaskType',
      entityId: tipo._id,
      action: 'create',
      description: `Tipo de tarea creado: ${tipo.name}.`,
      changes: { after: { key: tipo.key, name: tipo.name, color: tipo.color } },
      actor: req.usuario.username,
    });
    req.flash('exito', `Tipo de tarea ${tipo.name} creado.`);
    res.redirect('/agenda/tipos');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      return renderizarFormulario(req, res, { tipo: { ...payloadTipo(req.body), _id: null }, errores: erroresDe(error) });
    }
    next(error);
  }
}

/** GET /agenda/tipos/:id/editar */
async function formEditar(req, res, next) {
  try {
    const tipo = await TaskType.findById(req.params.id).lean();
    if (!tipo) throw crearError(404, 'El tipo de tarea no existe.');
    res.render('agenda/tipos-form', {
      titulo: `Editar ${tipo.name}`,
      tipo,
      modo: 'editar',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /agenda/tipos/:id */
async function actualizar(req, res, next) {
  try {
    const tipo = await TaskType.findById(req.params.id);
    if (!tipo) throw crearError(404, 'El tipo de tarea no existe.');
    const datos = payloadTipo(req.body);
    const errores = [];
    if (!datos.name || datos.name.length < 2) errores.push('El nombre debe tener al menos 2 caracteres.');
    if (datos.name.length > 60) errores.push('El nombre no puede superar 60 caracteres.');
    if (!/^#[0-9a-f]{6}$/.test(datos.color)) errores.push('El color debe tener el formato #RRGGBB.');
    if (!datos.active) {
      const otrosActivos = await TaskType.countDocuments({ active: true, _id: { $ne: tipo._id } });
      if (!otrosActivos) errores.push('Debe quedar al menos un tipo de tarea activo.');
    }
    if (errores.length) {
      return renderizarFormulario(req, res, { tipo: { ...tipo.toObject(), ...datos }, errores });
    }
    const antes = { name: tipo.name, color: tipo.color, active: tipo.active, order: tipo.order };
    tipo.name = datos.name;
    tipo.description = datos.description;
    tipo.color = datos.color;
    tipo.order = datos.order;
    tipo.active = datos.active;
    await tipo.save();
    await registrar({
      module: 'agenda',
      entity: 'TaskType',
      entityId: tipo._id,
      action: 'update',
      description: `Tipo de tarea actualizado: ${tipo.name}.`,
      changes: { before: antes, after: { name: tipo.name, color: tipo.color, active: tipo.active, order: tipo.order } },
      actor: req.usuario.username,
    });
    req.flash('exito', 'Tipo de tarea actualizado.');
    res.redirect('/agenda/tipos');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      const tipo = await TaskType.findById(req.params.id).lean().catch(() => null);
      return renderizarFormulario(req, res, {
        tipo: tipo ? { ...tipo, ...payloadTipo(req.body) } : { ...payloadTipo(req.body), _id: req.params.id },
        errores: erroresDe(error),
      });
    }
    next(error);
  }
}

/** DELETE /agenda/tipos/:id */
async function eliminar(req, res, next) {
  try {
    const tipo = await TaskType.findById(req.params.id);
    if (!tipo) throw crearError(404, 'El tipo de tarea no existe.');
    const usos = await WorkTask.countDocuments({ category: tipo.key });
    if (usos) {
      req.flash('error', `No se puede eliminar ${tipo.name}: ${usos} tarea(s) lo usan. Desactívalo para dejar de asignarlo.`);
      return res.redirect('/agenda/tipos');
    }
    if (await TaskType.countDocuments() <= 1) {
      req.flash('error', 'Debe existir al menos un tipo de tarea.');
      return res.redirect('/agenda/tipos');
    }
    await tipo.deleteOne();
    await registrar({
      module: 'agenda',
      entity: 'TaskType',
      entityId: tipo._id,
      action: 'delete',
      description: `Tipo de tarea eliminado: ${tipo.name}.`,
      changes: { before: { key: tipo.key, name: tipo.name } },
      actor: req.usuario.username,
    });
    req.flash('exito', 'Tipo de tarea eliminado.');
    res.redirect('/agenda/tipos');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, eliminar };
