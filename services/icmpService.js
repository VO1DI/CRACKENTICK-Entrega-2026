const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const net = require('node:net');

const ejecutar = promisify(execFile);

function hostValido(host) {
  const texto = String(host || '').trim();
  if (!texto) return false;
  if (net.isIP(texto)) return true;
  /* No permite opciones de ping ni espacios. */
  return /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(texto);
}

/** Hace un solo ping ICMP. No lanza: devuelve ok/error. */
async function ping(host, timeoutMs = 2000) {
  if (!hostValido(host)) return { ok: false, error: 'Host ICMP inválido.' };
  const espera = Math.max(500, Math.min(10000, Number(timeoutMs) || 2000));
  const args = process.platform === 'win32'
    ? ['-n', '1', '-w', String(espera), String(host)]
    : ['-c', '1', '-W', String(Math.max(1, Math.ceil(espera / 1000))), String(host)];
  const inicio = Date.now();
  try {
    await ejecutar('ping', args, { timeout: espera + 2000, windowsHide: true });
    return { ok: true, ms: Date.now() - inicio };
  } catch (error) {
    return { ok: false, ms: Date.now() - inicio, error: error.code || error.message };
  }
}

module.exports = { ping, hostValido };
