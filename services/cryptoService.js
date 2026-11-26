const crypto = require('node:crypto');

const PREFIJO = 'enc:v1:';

/**
 * Deriva una clave de 32 bytes desde un valor hex/base64 o, si está vacío,
 * desde SESSION_SECRET. El formato acepta 64 caracteres hex o base64.
 */
function claveDe(raw) {
  if (raw) {
    const limpio = String(raw).trim();
    if (/^[0-9a-f]{64}$/i.test(limpio)) return Buffer.from(limpio, 'hex');
    try {
      const buffer = Buffer.from(limpio, 'base64');
      if (buffer.length === 32) return buffer;
    } catch (error) {
      /* se usa la derivación */
    }
    return crypto.createHash('sha256').update(limpio).digest();
  }
  return crypto
    .createHash('sha256')
    .update(process.env.SESSION_SECRET || 'crackentick-clave-de-desarrollo')
    .digest();
}

function obtenerClave() {
  return claveDe(process.env.ENCRYPTION_KEY);
}

function descifrarCon(clave, texto) {
  const [ivB64, tagB64, datosB64] = texto.slice(PREFIJO.length).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', clave, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(datosB64, 'base64')), decipher.final()]).toString('utf8');
}

function cifrar(texto) {
  if (!texto) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', obtenerClave(), iv);
  const cifrado = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIJO}${iv.toString('base64')}:${tag.toString('base64')}:${cifrado.toString('base64')}`;
}

function descifrar(valor) {
  if (!valor) return '';
  const texto = String(valor);
  if (!texto.startsWith(PREFIJO)) return texto; // compatibilidad con valores antiguos
  try {
    return descifrarCon(obtenerClave(), texto);
  } catch (error) {
    /* Rotación de clave: mientras exista ENCRYPTION_KEY_OLD se aceptan ambos. */
    if (process.env.ENCRYPTION_KEY_OLD !== undefined) {
      try {
        return descifrarCon(claveDe(process.env.ENCRYPTION_KEY_OLD), texto);
      } catch (antigua) {
        /* ninguna clave sirve */
      }
    }
    return '';
  }
}

function estaCifrado(valor) {
  return typeof valor === 'string' && valor.startsWith(PREFIJO);
}

const MAGIC_BINARIO = Buffer.from('CTB1');

/** Cifra un Buffer (respaldos binarios) con AES-256-GCM. */
function cifrarBuffer(buffer) {
  if (!buffer || !buffer.length) return buffer;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', obtenerClave(), iv);
  const datos = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([MAGIC_BINARIO, iv, cipher.getAuthTag(), datos]);
}

/** Descifra un Buffer cifrado; si no tiene la marca, lo devuelve tal cual (legado). */
function descifrarBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < MAGIC_BINARIO.length + 28) return buffer;
  if (!buffer.subarray(0, MAGIC_BINARIO.length).equals(MAGIC_BINARIO)) return buffer;
  try {
    const iv = buffer.subarray(4, 16);
    const tag = buffer.subarray(16, 32);
    const datos = buffer.subarray(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', obtenerClave(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(datos), decipher.final()]);
  } catch (error) {
    throw new Error('No se pudo descifrar el respaldo binario; revisa ENCRYPTION_KEY.');
  }
}

module.exports = { cifrar, descifrar, estaCifrado, cifrarBuffer, descifrarBuffer };
