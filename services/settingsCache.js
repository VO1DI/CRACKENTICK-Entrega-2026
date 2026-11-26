const Settings = require('../models/Settings');

let cache = null;
let expira = 0;

/** Configuración para las vistas, cacheada 10 s. */
async function obtener() {
  if (cache && Date.now() < expira) return cache;
  cache = await Settings.getSingleton();
  expira = Date.now() + 10000;
  return cache;
}

/** Se llama al guardar una configuración visible para no esperar al TTL. */
function invalidar() {
  cache = null;
  expira = 0;
}

module.exports = { obtener, invalidar };
