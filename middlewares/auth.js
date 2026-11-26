const User = require('../models/User');
const { PERMISOS, GRUPOS_PERMISOS } = require('../config/constants');
const { nivel, puedeVer, puedeEditar } = require('../utils/permissions');
const { rutaInterna } = require('../utils/strings');

const NODOS = GRUPOS_PERMISOS.flatMap((grupo) => grupo.nodos).filter((nodo) => nodo.ruta);
const ALIAS_NODO = {
  '/facturas': 'finanzas.facturas',
  '/facturacion': 'finanzas.facturacion',
  '/tickets': 'soporte.tickets',
  '/inventario': 'ventas.inventario',
  '/planes': 'red.planes',
  '/routers': 'red.routers',
  '/pools': 'red.pools',
  '/monitoreo': 'red.monitoreo',
  '/configuracion': 'admin.configuracion',
  '/logs': 'admin.auditoria',
  '/red/ipam': 'red.pools',
  '/red/consumo': 'red.monitoreo',
  '/suscripciones': 'general.clientes',
};

function nodoDeRuta(ruta) {
  if (ALIAS_NODO[ruta]) return NODOS.find((nodo) => nodo.key === ALIAS_NODO[ruta]) || null;
  return (
    NODOS.filter((nodo) => ruta === nodo.ruta || ruta.startsWith(`${nodo.ruta}/`)).sort(
      (a, b) => b.ruta.length - a.ruta.length
    )[0] || null
  );
}

/**
 * Carga el usuario autenticado en `req.usuario` y en `res.locals`.
 * También expone el helper `puede(clave)` a todas las vistas.
 */
async function cargarUsuario(req, res, next) {
  req.usuario = null;
  res.locals.usuario = null;
  res.locals.puede = () => false;
  res.locals.puedeEditar = () => false;
  res.locals.nivelPermiso = () => 'none';
  res.locals.permisosUsuario = [];
  res.locals.nodoActual = null;
  res.locals.soloLectura = false;

  try {
    const id = req.session && req.session.usuarioId;
    if (!id) return next();

    const usuario = await User.findById(id).lean();
    if (!usuario || !usuario.active) {
      delete req.session.usuarioId;
      return next();
    }
    if (req.session.version !== undefined && Number(req.session.version) !== (Number(usuario.sessionVersion) || 0)) {
      delete req.session.usuarioId;
      return next();
    }

    const permisos = usuario.role === 'admin' ? [...PERMISOS] : usuario.permissions || [];
    req.usuario = usuario;
    res.locals.usuario = usuario;
    res.locals.permisosUsuario = permisos;
    res.locals.nivelPermiso = (clave) => nivel(usuario, clave);
    res.locals.puede = (clave) => puedeVer(usuario, clave);
    res.locals.puedeEditar = (clave) => puedeEditar(usuario, clave);
    const nodo = nodoDeRuta(req.path);
    res.locals.nodoActual = nodo;
    res.locals.soloLectura = nodo ? !puedeEditar(usuario, nodo.key) : false;
    return next();
  } catch (error) {
    return next(error);
  }
}

/** Exige una sesión activa. Guarda la ruta de retorno para después del login. */
function requiereAuth(req, res, next) {
  if (req.usuario) return next();

  if (req.session) {
    const destino = req.method === 'GET' ? rutaInterna(req.originalUrl, '') : '/';
    if (destino && destino !== '/login' && destino !== '/salir') req.session.returnTo = destino;
  }
  req.flash('error', 'Inicia sesión para continuar.');
  return res.redirect('/login');
}

/** Middleware de autorización por nodo. Los GET solo necesitan lectura. */
function requierePermiso(clave) {
  return function verificarPermiso(req, res, next) {
    if (!req.usuario) {
      req.flash('error', 'Inicia sesión para continuar.');
      return res.redirect('/login');
    }
    const soloLectura = req.method === 'GET' || req.method === 'HEAD';
    const autorizado = soloLectura ? puedeVer(req.usuario, clave) : puedeEditar(req.usuario, clave);
    if (autorizado) return next();

    const error = new Error(
      soloLectura
        ? 'No tienes permiso para ver este nodo.'
        : 'Tu permiso en este nodo es de solo lectura.'
    );
    error.status = 403;
    return next(error);
  };
}

/** Exige al menos uno de los permisos indicados (lectura para GET). */
function requiereAlgunPermiso(claves = []) {
  return function verificarAlguno(req, res, next) {
    if (!req.usuario) {
      req.flash('error', 'Inicia sesión para continuar.');
      return res.redirect('/login');
    }
    const soloLectura = req.method === 'GET' || req.method === 'HEAD';
    const autorizado = claves.some((clave) => (soloLectura ? puedeVer(req.usuario, clave) : puedeEditar(req.usuario, clave)));
    if (autorizado) return next();
    const error = new Error('No tienes permiso para entrar a este nodo.');
    error.status = 403;
    return next(error);
  };
}

/** Primera ruta permitida para un usuario (usada al iniciar sesión). */
function rutaInicial(usuario) {
  if (!usuario) return '/login';
  const puede = (clave) => puedeVer(usuario, clave);
  const candidatos = [
    ['general.dashboard', '/'],
    ...NODOS.filter((nodo) => nodo.ruta && nodo.key !== 'general.dashboard').map((nodo) => [nodo.key, nodo.ruta]),
  ];
  const encontrado = candidatos.find(([clave]) => puede(clave));
  if (encontrado) return encontrado[1];
  if (['clientes.datos', 'clientes.servicio', 'clientes.cortes', 'clientes.facturacion'].some((clave) => puede(clave))) {
    return '/clientes';
  }
  if (puede('ventas.instalar')) return '/ventas';
  return '/sin-acceso';
}

module.exports = { cargarUsuario, requiereAuth, requierePermiso, requiereAlgunPermiso, rutaInicial };
