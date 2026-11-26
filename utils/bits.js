/** Formatea bits por segundo a una unidad legible. */
function formatearBps(valor) {
  const bps = Math.max(0, Number(valor) || 0);
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
  return `${Math.round(bps)} bps`;
}

module.exports = { formatearBps };
