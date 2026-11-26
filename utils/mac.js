/** Normaliza una MAC a AA:BB:CC:DD:EE:FF. Devuelve '' si no es válida. */
function normalizarMac(valor) {
  const limpio = String(valor || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  if (limpio.length !== 12) return '';
  return limpio.match(/.{2}/g).join(':');
}

function esMacValida(valor) {
  return normalizarMac(valor) !== '';
}

module.exports = { normalizarMac, esMacValida };
