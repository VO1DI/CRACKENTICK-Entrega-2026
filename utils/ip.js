/**
 * Utilidades IPv4 y CIDR.
 *
 * Permiten validar un bloque como `192.168.0.0/24`, calcular cuántas
 * direcciones contiene y enumerar las IP usables para asignarlas a clientes.
 */

const MAX_PREFIJO = 32;
const MIN_PREFIJO = 16; // Evita bloques gigantes en memoria.

function ipAEntero(ip) {
  const partes = String(ip).trim().split('.');
  if (partes.length !== 4) return null;
  let entero = 0;
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null;
    const valor = Number(parte);
    if (valor < 0 || valor > 255) return null;
    entero = (entero * 256) + valor;
  }
  return entero >>> 0;
}

function enteroAIp(entero) {
  return [
    (entero >>> 24) & 255,
    (entero >>> 16) & 255,
    (entero >>> 8) & 255,
    entero & 255,
  ].join('.');
}

function esIpValida(ip) {
  return ipAEntero(ip) !== null;
}

/**
 * Analiza un CIDR y devuelve sus metadatos.
 * @returns {{ok: boolean, error?: string, network?: string, prefix?: number,
 *   firstUsable?: string, lastUsable?: string, total?: number, usable?: number,
 *   networkInt?: number, broadcastInt?: number}}
 */
function analizarCidr(cidr) {
  const texto = String(cidr || '').trim();
  const partes = texto.split('/');
  if (partes.length !== 2) {
    return { ok: false, error: 'El bloque debe tener el formato 192.168.0.0/24.' };
  }

  const ipInt = ipAEntero(partes[0]);
  const prefix = Number(partes[1]);
  if (ipInt === null) return { ok: false, error: 'La dirección de red no es válida.' };
  if (!Number.isInteger(prefix) || prefix < MIN_PREFIJO || prefix > MAX_PREFIJO) {
    return { ok: false, error: `El prefijo debe estar entre /${MIN_PREFIJO} y /${MAX_PREFIJO}.` };
  }

  const hostBits = 32 - prefix;
  const tamano = 2 ** hostBits;
  const mascara = prefix === 0 ? 0 : (0xffffffff << hostBits) >>> 0;
  const networkInt = (ipInt & mascara) >>> 0;
  const broadcastInt = (networkInt + tamano - 1) >>> 0;

  let firstUsable;
  let lastUsable;
  let usable;

  if (prefix >= 31) {
    firstUsable = enteroAIp(networkInt);
    lastUsable = enteroAIp(broadcastInt);
    usable = tamano;
  } else {
    firstUsable = enteroAIp(networkInt + 1);
    lastUsable = enteroAIp(broadcastInt - 1);
    usable = tamano - 2;
  }

  return {
    ok: true,
    network: enteroAIp(networkInt),
    prefix,
    firstUsable,
    lastUsable,
    total: tamano,
    usable,
    networkInt,
    broadcastInt,
    rangeLabel: `${enteroAIp(networkInt)}/${prefix}`,
  };
}

/** Lista las IP usables de un bloque. `limite` protege contra bloques enormes. */
function enumerarCidr(cidr, limite = 4096) {
  const datos = analizarCidr(cidr);
  if (!datos.ok) return [];
  const primera = datos.networkInt + (datos.prefix >= 31 ? 0 : 1);
  const total = Math.min(datos.usable, limite);
  const ips = [];
  for (let i = 0; i < total; i += 1) {
    ips.push(enteroAIp(primera + i));
  }
  return ips;
}

/** Devuelve la primera IP usable que no esté en `usadas`. */
function primeraIpLibre(cidr, usadas = new Set(), limite = 65534) {
  const datos = analizarCidr(cidr);
  if (!datos.ok) return null;
  const primera = datos.networkInt + (datos.prefix >= 31 ? 0 : 1);
  const total = Math.min(datos.usable, limite);
  for (let i = 0; i < total; i += 1) {
    const ip = enteroAIp(primera + i);
    if (!usadas.has(ip)) return ip;
  }
  return null;
}

/** Identifica si una IP pertenece al bloque. */
function ipEnCidr(ip, cidr) {
  const datos = analizarCidr(cidr);
  const entero = ipAEntero(ip);
  if (!datos.ok || entero === null) return false;
  return entero >= datos.networkInt && entero <= datos.broadcastInt;
}

function contarIps(cidr) {
  const datos = analizarCidr(cidr);
  return datos.ok ? datos.usable : 0;
}

module.exports = {
  MIN_PREFIJO,
  MAX_PREFIJO,
  ipAEntero,
  enteroAIp,
  esIpValida,
  analizarCidr,
  enumerarCidr,
  primeraIpLibre,
  ipEnCidr,
  contarIps,
};
