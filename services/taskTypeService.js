const TaskType = require('../models/TaskType');

/** Tipos iniciales; los que ya existen no se tocan. */
const TIPOS_POR_DEFECTO = [
  { key: 'instalacion', name: 'Instalación', color: '#38bdf8', order: 10 },
  { key: 'soporte', name: 'Soporte', color: '#22d3ee', order: 20 },
  { key: 'ip_publica', name: 'Cambio de IP pública', color: '#a78bfa', order: 30 },
  { key: 'desbaneo', name: 'Desbaneo de IP', color: '#fb923c', order: 40 },
  { key: 'mantenimiento', name: 'Mantenimiento', color: '#34d399', order: 50 },
  { key: 'otro', name: 'Otro', color: '#94a3b8', order: 60 },
];

/** Crea los tipos que falten sin sobrescribir nombre ni color. */
async function asegurarTipos() {
  await Promise.all(
    TIPOS_POR_DEFECTO.map((tipo) =>
      TaskType.updateOne({ key: tipo.key }, { $setOnInsert: tipo }, { upsert: true }).catch((error) => {
        if (error.code !== 11000) throw error;
      })
    )
  );
}

async function listar({ soloActivos = true } = {}) {
  const filtro = soloActivos ? { active: true } : {};
  return TaskType.find(filtro).sort({ order: 1, name: 1 }).lean();
}

async function mapa() {
  const tipos = await listar({ soloActivos: false });
  return new Map(tipos.map((tipo) => [tipo.key, tipo]));
}

module.exports = { TIPOS_POR_DEFECTO, asegurarTipos, listar, mapa };
