const User = require('../models/User');

/**
 * Traduce el usuario de cada registro de auditoría a su nombre real.
 * Si el usuario ya no existe, se queda el identificador guardado.
 */
async function resolverActores(logs = []) {
  const usuarios = [...new Set(logs.map((log) => log.actor).filter((actor) => actor && actor !== 'system'))];
  if (!usuarios.length) return logs;
  const encontrados = await User.find({ username: { $in: usuarios } }).select('username name').lean();
  const nombres = new Map(encontrados.map((usuario) => [usuario.username, usuario.name]));
  logs.forEach((log) => {
    log.actorNombre = nombres.get(log.actor) || (log.actor === 'system' ? 'Sistema' : log.actor);
  });
  return logs;
}

module.exports = { resolverActores };
