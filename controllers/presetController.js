const PermissionPreset = require('../models/PermissionPreset');
const { GRUPOS_PERMISOS } = require('../config/constants');
const { permisosDesdeFormulario } = require('../utils/permissions');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');

function payloadPreset(body = {}) {
  return {
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    permissions: permisosDesdeFormulario(body, GRUPOS_PERMISOS),
    active: body.active === 'on' || body.active === 'true',
  };
}

function erroresDe(error) {
  if (error.name === 'ValidationError') return Object.values(error.errors).map((detalle) => detalle.message);
  if (error.code === 11000) return ['Ya existe un preset con ese nombre.'];
  return [error.message || 'No se pudo guardar el preset.'];
}

async function renderizarFormulario(req, res, { preset, errores, status = 422 }) {
  return res.status(status).render('users/preset-form', {
    titulo: preset._id ? `Editar ${preset.name}` : 'Nuevo preset de permisos',
    preset,
    modo: preset._id ? 'editar' : 'crear',
    errores,
  });
}

/** GET /admin/usuarios/presets */
async function index(req, res, next) {
  try {
    const presets = await PermissionPreset.find().sort({ name: 1 }).lean();
    res.render('users/presets', { titulo: 'Presets de permisos', presets });
  } catch (error) {
    next(error);
  }
}

/** GET /admin/usuarios/presets/nuevo */
function formNuevo(req, res) {
  res.render('users/preset-form', {
    titulo: 'Nuevo preset de permisos',
    preset: { name: '', description: '', permissions: [], active: true },
    modo: 'crear',
    errores: [],
  });
}

/** POST /admin/usuarios/presets */
async function crear(req, res, next) {
  try {
    const datos = payloadPreset(req.body);
    const errores = [];
    if (!datos.name || datos.name.length < 2) errores.push('El nombre debe tener al menos 2 caracteres.');
    if (!datos.permissions.length) errores.push('Selecciona al menos un permiso.');
    if (errores.length) {
      return renderizarFormulario(req, res, { preset: { ...datos, _id: null }, errores });
    }
    const preset = await PermissionPreset.create(datos);
    await registrar({
      module: 'auth',
      entity: 'PermissionPreset',
      entityId: preset._id,
      action: 'create',
      description: `Preset de permisos creado: ${preset.name}.`,
      changes: { after: { name: preset.name, permissions: preset.permissions } },
      actor: req.usuario.username,
    });
    req.flash('exito', `Preset ${preset.name} creado. No cambia los permisos de ningún usuario.`);
    res.redirect('/admin/usuarios/presets');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      return renderizarFormulario(req, res, { preset: { ...payloadPreset(req.body), _id: null }, errores: erroresDe(error) });
    }
    next(error);
  }
}

/** GET /admin/usuarios/presets/:id/editar */
async function formEditar(req, res, next) {
  try {
    const preset = await PermissionPreset.findById(req.params.id).lean();
    if (!preset) throw crearError(404, 'El preset no existe.');
    res.render('users/preset-form', {
      titulo: `Editar ${preset.name}`,
      preset,
      modo: 'editar',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /admin/usuarios/presets/:id */
async function actualizar(req, res, next) {
  try {
    const preset = await PermissionPreset.findById(req.params.id);
    if (!preset) throw crearError(404, 'El preset no existe.');
    const datos = payloadPreset(req.body);
    const errores = [];
    if (!datos.name || datos.name.length < 2) errores.push('El nombre debe tener al menos 2 caracteres.');
    if (!datos.permissions.length) errores.push('Selecciona al menos un permiso.');
    if (errores.length) {
      return renderizarFormulario(req, res, { preset: { ...preset.toObject(), ...datos }, errores });
    }
    const antes = { name: preset.name, permissions: [...preset.permissions], active: preset.active };
    preset.name = datos.name;
    preset.description = datos.description;
    preset.permissions = datos.permissions;
    preset.active = datos.active;
    await preset.save();
    await registrar({
      module: 'auth',
      entity: 'PermissionPreset',
      entityId: preset._id,
      action: 'update',
      description: `Preset de permisos actualizado: ${preset.name}. No se tocaron usuarios.`,
      changes: { before: antes, after: { name: preset.name, permissions: preset.permissions, active: preset.active } },
      actor: req.usuario.username,
    });
    req.flash('exito', 'Preset actualizado. Los usuarios existentes conservan sus permisos.');
    res.redirect('/admin/usuarios/presets');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      const preset = await PermissionPreset.findById(req.params.id).lean().catch(() => null);
      return renderizarFormulario(req, res, {
        preset: preset ? { ...preset, ...payloadPreset(req.body) } : { ...payloadPreset(req.body), _id: req.params.id },
        errores: erroresDe(error),
      });
    }
    next(error);
  }
}

/** DELETE /admin/usuarios/presets/:id */
async function eliminar(req, res, next) {
  try {
    const preset = await PermissionPreset.findById(req.params.id);
    if (!preset) throw crearError(404, 'El preset no existe.');
    await preset.deleteOne();
    await registrar({
      module: 'auth',
      entity: 'PermissionPreset',
      entityId: preset._id,
      action: 'delete',
      description: `Preset de permisos eliminado: ${preset.name}.`,
      changes: { before: { name: preset.name, permissions: preset.permissions } },
      actor: req.usuario.username,
    });
    req.flash('exito', 'Preset eliminado. Los usuarios conservan sus permisos.');
    res.redirect('/admin/usuarios/presets');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, eliminar };
