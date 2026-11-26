const crypto = require('node:crypto');

const LONGITUD_CLAVE = 64;

/** Genera un hash `scrypt` con sal aleatoria para guardar contraseñas. */
function hashPassword(password) {
  const texto = String(password || '');
  if (texto.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(texto, salt, LONGITUD_CLAVE).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

/** Compara una contraseña en texto plano con el hash almacenado. */
function verifyPassword(password, almacenado) {
  try {
    const partes = String(almacenado || '').split(':');
    if (partes.length !== 3 || partes[0] !== 'scrypt') return false;
    const [, salt, hash] = partes;
    const calculado = crypto.scryptSync(String(password || ''), salt, LONGITUD_CLAVE);
    const esperado = Buffer.from(hash, 'hex');
    if (esperado.length !== calculado.length) return false;
    return crypto.timingSafeEqual(esperado, calculado);
  } catch (error) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
