const User = require('../models/User');
const PermissionPreset = require('../models/PermissionPreset');
const { registrar } = require('../services/auditService');
const { crearError, mensajeDeError } = require('../utils/errors');
const { ROLES_USUARIO, ETIQUETAS_ROL, GRUPOS_PERMISOS } = require('../config/constants');
const { escaparRegex, rutaInterna } = require('../utils/strings');
const { permisosDesdeFormulario, puedeEditar, puedeVer } = require('../utils/permissions');

/** Un usuario no administrador solo puede conceder nodos que él mismo alcanza. */
function limitarPermisos(permisos, actor) {
  if (!actor || actor.role === 'admin') return permisos;
  return permisos.filter((permiso) => {
    const clave = permiso.replace(/:read$/, '');
    return permiso.endsWith(':read') ? puedeVer(actor, clave) : puedeEditar(actor, clave);
  });
}

function leerPermisos(body = {}) {
  return permisosDesdeFormulario(body, GRUPOS_PERMISOS);
}

async function presetsActivos() {
  return PermissionPreset.find({ active: true }).sort({ name: 1 }).lean();
}

function payloadUsuario(body = {}) {
  return {
    name: String(body.name || '').trim(),
    username: String(body.username || '').trim().toLowerCase(),
    email: String(body.email || '').trim().toLowerCase(),
    role: ROLES_USUARIO.includes(body.role) ? body.role : 'staff',
    permissions: leerPermisos(body),
    active: body.active === 'on' || body.active === 'true',
  };
}

/** GET /admin/usuarios */
async function index(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    const consulta = {};
    if (q) {
      const regex = new RegExp(escaparRegex(q), 'i');
      consulta.$or = [{ name: regex }, { username: regex }, { email: regex }];
    }

    const [usuariosBase, totales] = await Promise.all([
      User.find(consulta).sort({ role: 1, name: 1 }).lean(),
      Promise.all([
        User.countDocuments(),
        User.countDocuments({ active: true }),
        User.countDocuments({ role: 'admin' }),
      ]),
    ]);
    /* lean() no aplica el virtual initials. */
    const usuarios = usuariosBase.map((u) => ({
      ...u,
      initials: String(u.name || u.username || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((parte) => parte[0].toUpperCase())
        .join(''),
    }));

    res.render('users/index', {
      titulo: 'Usuarios y permisos',
      usuarios,
      filtros: { q },
      resumen: { total: totales[0], activos: totales[1], admins: totales[2] },
      etiquetasRol: ETIQUETAS_ROL,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /admin/usuarios/nuevo */
async function formNuevo(req, res, next) {
  try {
    res.render('users/form', {
      titulo: 'Nuevo usuario',
      usuarioEditado: { name: '', username: '', email: '', role: 'staff', permissions: [], active: true },
      modo: 'crear',
      errores: [],
      presets: await presetsActivos(),
    });
  } catch (error) {
    next(error);
  }
}

/** POST /admin/usuarios */
async function crear(req, res, next) {
  try {
    const datos = payloadUsuario(req.body);
    datos.permissions = limitarPermisos(datos.permissions, req.usuario);
    const password = String(req.body.password || '');
    const errores = [];
    if (!datos.name) errores.push('El nombre es obligatorio.');
    if (!datos.username) errores.push('El usuario de inicio de sesión es obligatorio.');
    if (password.length < 6) errores.push('La contraseña debe tener al menos 6 caracteres.');
    if (datos.role === 'admin' && req.usuario.role !== 'admin') {
      errores.push('Solo un administrador puede crear otro administrador.');
    }
    if (errores.length) {
      return res.status(422).render('users/form', {
        titulo: 'Nuevo usuario',
        usuarioEditado: { ...datos, password: '' },
        modo: 'crear',
        errores,
        presets: await presetsActivos(),
      });
    }

    const usuario = new User(datos);
    usuario.establecerPassword(password);
    await usuario.save();

    await registrar({
      module: 'auth',
      entity: 'User',
      entityId: usuario._id,
      action: 'create',
      description: `Usuario creado: ${usuario.name} (${usuario.username}) con rol ${usuario.role}.`,
      changes: { after: { name: usuario.name, username: usuario.username, role: usuario.role, permissions: usuario.permissions } },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', `Usuario ${usuario.username} creado correctamente.`);
    const destino = String(req.body.returnTo || '');
    res.redirect(rutaInterna(destino, '/admin/usuarios'));
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      return res.status(422).render('users/form', {
        titulo: 'Nuevo usuario',
        usuarioEditado: { ...payloadUsuario(req.body), password: '' },
        modo: 'crear',
        errores:
          error.code === 11000
            ? ['Ese usuario de inicio de sesión ya existe.']
            : Object.values(error.errors).map((detalle) => detalle.message),
        presets: await presetsActivos(),
      });
    }
    next(error);
  }
}

/** GET /admin/usuarios/:id/editar */
async function formEditar(req, res, next) {
  try {
    const usuarioEditado = await User.findById(req.params.id).lean();
    if (!usuarioEditado) throw crearError(404, 'El usuario no existe.');
    res.render('users/form', {
      titulo: `Editar ${usuarioEditado.name}`,
      usuarioEditado,
      modo: 'editar',
      errores: [],
      presets: await presetsActivos(),
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /admin/usuarios/:id */
async function actualizar(req, res, next) {
  try {
    const usuario = await User.findById(req.params.id);
    if (!usuario) throw crearError(404, 'El usuario no existe.');

    const datos = payloadUsuario(req.body);
    datos.permissions = limitarPermisos(datos.permissions, req.usuario);
    const password = String(req.body.password || '');

    if (!datos.name) datos.name = usuario.name;
    if (!datos.username) datos.username = usuario.username;

    const esAdminActual = req.usuario.role === 'admin';
    if (!esAdminActual && (usuario.role === 'admin' || datos.role === 'admin')) {
      req.flash('error', 'Solo un administrador puede modificar o asignar el rol de administrador.');
      return res.redirect(`/admin/usuarios/${usuario._id}/editar`);
    }

    // Protecciones: no dejar el sistema sin administradores ni desactivarse a sí mismo.
    if (String(usuario._id) === String(req.usuario._id) && usuario.role === 'admin') {
      if (datos.role !== 'admin') {
        req.flash('error', 'No puedes quitarte tu propio rol de administrador.');
        return res.redirect(`/admin/usuarios/${usuario._id}/editar`);
      }
      if (!datos.active) {
        req.flash('error', 'No puedes desactivar tu propio usuario.');
        return res.redirect(`/admin/usuarios/${usuario._id}/editar`);
      }
    }

    if (usuario.role === 'admin' && datos.role !== 'admin') {
      const admins = await User.countDocuments({ role: 'admin', active: true });
      if (admins <= 1) {
        req.flash('error', 'Debe existir al menos un administrador activo.');
        return res.redirect(`/admin/usuarios/${usuario._id}/editar`);
      }
    }

    const antes = {
      name: usuario.name,
      username: usuario.username,
      role: usuario.role,
      permissions: [...usuario.permissions],
      active: usuario.active,
    };

    usuario.name = datos.name;
    usuario.username = datos.username;
    usuario.email = datos.email;
    usuario.role = datos.role;
    usuario.permissions = datos.permissions;
    usuario.active = datos.active;
    if (password) {
      if (password.length < 6) {
        req.flash('error', 'La contraseña debe tener al menos 6 caracteres.');
        return res.redirect(`/admin/usuarios/${usuario._id}/editar`);
      }
      usuario.establecerPassword(password);
      usuario.sessionVersion = (Number(usuario.sessionVersion) || 0) + 1;
    }

    await usuario.save();
    if (String(usuario._id) === String(req.usuario._id)) {
      req.session.version = Number(usuario.sessionVersion) || 0;
    }

    await registrar({
      module: 'auth',
      entity: 'User',
      entityId: usuario._id,
      action: 'update',
      description: `Usuario actualizado: ${usuario.name} (${usuario.username}).`,
      changes: {
        before: antes,
        after: { name: usuario.name, username: usuario.username, role: usuario.role, permissions: usuario.permissions, active: usuario.active },
      },
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', 'Usuario actualizado.');
    res.redirect('/admin/usuarios');
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      req.flash(
        'error',
        error.code === 11000 ? 'Ese usuario de inicio de sesión ya existe.' : mensajeDeError(error)
      );
      return res.redirect(`/admin/usuarios/${req.params.id}/editar`);
    }
    next(error);
  }
}

/** POST /admin/usuarios/:id/estado */
async function cambiarEstado(req, res, next) {
  try {
    const usuario = await User.findById(req.params.id);
    if (!usuario) throw crearError(404, 'El usuario no existe.');
    if (req.usuario.role !== 'admin' && usuario.role === 'admin') {
      req.flash('error', 'Solo un administrador puede cambiar el estado de otro administrador.');
      return res.redirect('/admin/usuarios');
    }
    if (String(usuario._id) === String(req.usuario._id)) {
      req.flash('error', 'No puedes desactivar tu propio usuario.');
      return res.redirect('/admin/usuarios');
    }
    if (usuario.role === 'admin' && usuario.active) {
      const admins = await User.countDocuments({ role: 'admin', active: true });
      if (admins <= 1) {
        req.flash('error', 'Debe existir al menos un administrador activo.');
        return res.redirect('/admin/usuarios');
      }
    }
    usuario.active = !usuario.active;
    await usuario.save();
    await registrar({
      module: 'auth',
      entity: 'User',
      entityId: usuario._id,
      action: 'update',
      description: `Usuario ${usuario.username} ${usuario.active ? 'activado' : 'desactivado'}.`,
      changes: { after: { active: usuario.active } },
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    req.flash('exito', `Usuario ${usuario.active ? 'activado' : 'desactivado'}.`);
    res.redirect('/admin/usuarios');
  } catch (error) {
    next(error);
  }
}

/** DELETE /admin/usuarios/:id */
async function eliminar(req, res, next) {
  try {
    if (String(req.params.id) === String(req.usuario._id)) {
      req.flash('error', 'No puedes eliminar tu propio usuario.');
      return res.redirect('/admin/usuarios');
    }
    const usuario = await User.findById(req.params.id);
    if (!usuario) throw crearError(404, 'El usuario no existe.');
    if (req.usuario.role !== 'admin' && usuario.role === 'admin') {
      req.flash('error', 'Solo un administrador puede eliminar a otro administrador.');
      return res.redirect('/admin/usuarios');
    }
    if (usuario.role === 'admin') {
      const admins = await User.countDocuments({ role: 'admin' });
      if (admins <= 1) {
        req.flash('error', 'Debe existir al menos un administrador.');
        return res.redirect('/admin/usuarios');
      }
    }
    await usuario.deleteOne();
    await registrar({
      module: 'auth',
      entity: 'User',
      entityId: usuario._id,
      action: 'delete',
      description: `Usuario eliminado: ${usuario.name} (${usuario.username}).`,
      changes: { before: { name: usuario.name, username: usuario.username, role: usuario.role } },
      actor: req.usuario ? req.usuario.username : 'admin',
    });
    req.flash('exito', 'Usuario eliminado.');
    res.redirect('/admin/usuarios');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, cambiarEstado, eliminar };
