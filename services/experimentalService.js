const NetworkBackup = require('../models/NetworkBackup');
const routeros = require('./routeros');

const SECCIONES_RESPALDO = {
  filtros: '/ip/firewall/filter/print',
  mangle: '/ip/firewall/mangle/print',
  direcciones: '/ip/address/print',
  vlan: '/interface/vlan/print',
  eoip: '/interface/eoip/print',
  rutas: '/ip/route/print',
};

/** Guarda una copia de las secciones de red antes de aplicar cambios. */
async function respaldar(router, actor = 'system', kind = 'experimental') {
  const data = {};
  const conexion = await routeros.conectar(router);
  try {
    for (const [clave, path] of Object.entries(SECCIONES_RESPALDO)) {
      try {
        const filas = await conexion.write(path);
        data[clave] = (filas || []).slice(0, 500);
      } catch (error) {
        data[clave] = { error: error.message };
      }
    }
  } finally {
    routeros.cerrar(conexion);
  }
  return NetworkBackup.create({
    routerId: router._id,
    routerName: router.name,
    kind,
    data,
    actor,
  });
}

module.exports = { respaldar };
