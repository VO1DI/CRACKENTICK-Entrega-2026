/** Caché corta del badge de alertas; se invalida al crear o resolver. */
const cache = new Map();

function obtener(clave) {
  const entrada = cache.get(clave);
  if (!entrada || Date.now() >= entrada.expira) {
    cache.delete(clave);
    return null;
  }
  return entrada.valor;
}

function guardar(clave, valor, ms = 10000) {
  cache.set(clave, { valor, expira: Date.now() + ms });
}

function invalidar() {
  cache.clear();
}

module.exports = { obtener, guardar, invalidar };
