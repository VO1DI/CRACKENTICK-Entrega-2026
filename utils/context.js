const { AsyncLocalStorage } = require('node:async_hooks');

const almacen = new AsyncLocalStorage();

function ejecutarConContexto(datos, fn) {
  return almacen.run(datos, fn);
}

function actorActual() {
  const estado = almacen.getStore();
  return estado && estado.actor ? estado.actor : null;
}

/** Modelo de IA que intervino en la petición, si aplica. */
function iaActual() {
  const estado = almacen.getStore();
  return estado && estado.ia ? estado.ia : null;
}

module.exports = { ejecutarConContexto, actorActual, iaActual };
