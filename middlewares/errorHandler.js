const { crearError } = require('../utils/errors');

/** Rutas inexistentes -> 404 */
function noEncontrado(req, res, next) {
  next(crearError(404, `No se encontró la ruta ${req.method} ${req.originalUrl}`));
}

/** Middleware central de errores: responde con la vista adecuada. */
function manejadorErrores(error, req, res, next) {
  if (res.headersSent) return next(error);

  let status = Number.isInteger(error.status) ? error.status : 500;
  let detalles = Array.isArray(error.detalles) ? error.detalles : [];

  if (error.name === 'ValidationError') {
    status = 422;
    detalles = Object.values(error.errors).map((detalle) => detalle.message);
  }

  if (error.name === 'CastError') {
    status = 404;
    error.message = 'El registro solicitado no existe.';
  }

  if (error.name === 'StrictModeError') {
    status = 400;
  }

  if (error.code === 11000) {
    status = 409;
    detalles = ['Ya existe un registro con ese valor.'];
  }

  if (status >= 500) {
    console.error(
      `💥 [${status}] ${req.method} ${req.originalUrl} (${req.usuario ? req.usuario.username : 'anon'})`,
      error.stack || error.message
    );
  }

  /* Las rutas de API siempre responden JSON, también ante cuerpos inválidos. */
  if (req.path.startsWith('/api/') || req.path === '/portal/preferencia-tema') {
    return res.status(status).json({
      ok: false,
      mensaje: error.message || 'No se pudo procesar la solicitud.',
      detalles,
    });
  }

  /* Si el error ocurre antes de cargar los locales (por ejemplo CSRF), el layout
     completo no tiene usuario ni configuración: se usa un layout mínimo. */
  const layout = res.locals.nombreApp ? 'layout' : 'layouts/error';

  if (status === 403) {
    return res.status(403).render('errors/403', {
      layout,
      titulo: 'Acceso restringido',
      mensaje: error.message || 'No tienes permiso para entrar a este nodo.',
    });
  }

  if (status === 404) {
    return res.status(404).render('errors/404', {
      layout,
      titulo: 'Página no encontrada',
      mensaje: error.message || 'La página que buscas no existe.',
    });
  }

  if (status === 500) {
    return res.status(500).render('errors/500', {
      layout,
      titulo: 'Error del servidor',
      mensaje: 'Ocurrió un problema inesperado. Intenta de nuevo en unos segundos.',
      detalles: [],
      stack: process.env.NODE_ENV === 'production' ? null : error.stack,
    });
  }

  return res.status(status).render('errors/400', {
    layout,
    titulo: status === 409 ? 'Conflicto de datos' : 'Datos inválidos',
    mensaje: error.message || 'Algunos datos no cumplen las validaciones.',
    detalles,
    status,
  });
}

module.exports = { noEncontrado, manejadorErrores };
