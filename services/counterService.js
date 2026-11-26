const Counter = require('../models/Counter');

const SERIES = {
  sale: { prefijo: 'VEN-', digitos: 4 },
  client: { prefijo: 'CL-', digitos: 4 },
  ticket: { prefijo: 'TCK-', digitos: 5 },
  inventory: { prefijo: 'ART-', digitos: 4 },
};

function formatear(clave, numero) {
  const serie = SERIES[clave];
  if (!serie) throw new Error(`Serie desconocida: ${clave}`);
  return `${serie.prefijo}${String(numero).padStart(serie.digitos, '0')}`;
}

/** Siguiente código de la serie, sin condiciones de carrera. */
async function siguiente(clave) {
  return formatear(clave, await Counter.siguiente(clave));
}

/**
 * Toma el máximo código ya existente para que las bases viejas no empiecen
 * otra vez en 1. Se ejecuta al arrancar; es idempotente.
 */
async function asegurarContadores() {
  const definiciones = [
    ['sale', require('../models/Sale'), 'code', /^VEN-\d+$/],
    ['client', require('../models/Client'), 'clientCode', /^CL-\d+$/],
    ['ticket', require('../models/Ticket'), 'code', /^TCK-\d+$/],
    ['inventory', require('../models/InventoryItem'), 'code', /^ART-\d+$/],
  ];

  for (const [clave, Modelo, campo, patron] of definiciones) {
    const ultimo = await Modelo.findOne({ [campo]: patron }).sort({ [campo]: -1 }).select(campo).lean();
    const numero = ultimo ? Number(String(ultimo[campo]).replace(/\D/g, '')) || 0 : 0;
    await Counter.updateOne({ key: clave }, { $max: { seq: numero } }, { upsert: true });
  }
}

module.exports = { siguiente, asegurarContadores, SERIES, formatear };
