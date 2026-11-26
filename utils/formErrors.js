const { mensajeDeError } = require('./errors');

/**
 * Convierte un error de Mongoose o de negocio en una lista para el resumen y
 * un mapa por campo para pintar el mensaje junto al control que lo causó.
 * `mapa` traduce rutas internas (customer.firstName) a nombres del formulario.
 */
function normalizarErrores(error, mapa = {}) {
  const campos = {};
  const general = [];

  if (!error) return { lista: [], campos };

  if (error.campos) Object.assign(campos, error.campos);

  if (error.name === 'ValidationError') {
    for (const [ruta, detalle] of Object.entries(error.errors || {})) {
      campos[mapa[ruta] || ruta] = detalle.message;
    }
  } else if (error.code === 11000) {
    const ruta = Object.keys(error.keyPattern || {})[0] || 'general';
    campos[mapa[ruta] || ruta] = mensajeDeError(error);
  } else if (!error.campos) {
    general.push(mensajeDeError(error));
  }

  const lista = [...new Set([...general, ...Object.values(campos)])];
  return { lista, campos };
}

module.exports = { normalizarErrores };
