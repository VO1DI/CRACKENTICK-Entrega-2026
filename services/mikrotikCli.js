const ssh = require('./mikrotikSsh');

/**
 * Ejecuta los comandos estructurados del sistema por la consola SSH.
 * Se usa solo cuando el router tiene `transport: 'ssh'` (modo emergencia).
 * Traduce `path/params/lookup` a CLI de RouterOS y deja que el router resuelva
 * el `find`, así el cambio es atómico y no hay que interpretar identificadores.
 */

const FALLO = /^\s*(failure|bad command|invalid|expected|no such item|cannot|already have|not enough permissions|syntax error)/i;

function valor(texto) {
  /* Sin saltos de línea: un nombre con "\n" no puede inyectar otro comando. */
  const limpio = String(texto).replace(/[\r\n]+/g, ' ').trim();
  /* RouterOS parte los valores con `/` y expande `$` dentro de comillas. */
  if (/^[A-Za-z0-9._-]+$/.test(limpio)) return limpio;
  return `"${limpio.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;
}

function argumentos(params = []) {
  return params
    .map((parametro) => {
      const plano = String(parametro).replace(/[\r\n]+/g, ' ');
      const partes = /^=([^=]+)=(.*)$/.exec(plano);
      return partes ? `${partes[1]}=${valor(partes[2])}` : plano;
    })
    .join(' ');
}

function selector(filters = []) {
  return filters
    .map((filtro) => {
      const plano = String(filtro).replace(/[\r\n]+/g, ' ');
      const partes = /^\?([^=]+)=(.*)$/.exec(plano);
      return partes ? `${partes[1]}=${valor(partes[2])}` : plano;
    })
    .join(' ');
}

/** Oculta claves en el texto que se devuelve (y acaba en auditoría). */
function ocultarSecretos(linea) {
  return String(linea).replace(
    /((?:password|passphrase|secret|private-key)=)(?:"(?:[^"\\]|\\.)*"|[^\s]+)/gi,
    '$1"******"'
  );
}

function construir(cmd) {
  const ruta = String(cmd.path || '');
  const accion = (/^\/(.+)\/(add|set|remove)$/.exec(ruta) || [])[2] || '';
  const base = ruta.replace(/\/(add|set|remove)$/, '');
  if (!base || !accion) throw new Error(`Comando SSH no soportado: ${ruta}`);
  const criterio = cmd.lookup ? selector(cmd.lookup.filters) : '';
  const buscar = criterio ? `[${base}/find ${criterio}]` : '';

  if (accion === 'remove') {
    if (!buscar) throw new Error(`Falta el criterio para eliminar en ${base}.`);
    return `${base}/remove ${buscar}`;
  }
  if (accion === 'set') {
    if (!buscar) throw new Error(`Falta el criterio para modificar en ${base}.`);
    return `${base}/set ${buscar} ${argumentos(cmd.params)}`;
  }
  if (cmd.upsert && buscar) {
    const alModificar = argumentos(cmd.paramsSet || cmd.params);
    return `:if ([:len ${buscar}] > 0) do={${base}/set ${buscar} ${alModificar}} else={${base}/add ${argumentos(cmd.params)}}`;
  }
  return `${base}/add ${argumentos(cmd.params)}`;
}

async function ejecutar(router, cmd) {
  const linea = construir(cmd);
  const salida = await ssh.ejecutar(router, [linea]);
  const fallo = salida
    .split(/\r?\n/)
    .map((texto) => texto.trim())
    .find((texto) => FALLO.test(texto));

  if (fallo) return { ok: false, result: fallo.slice(0, 300) };
  return { ok: true, result: `SSH: ${ocultarSecretos(linea)}`.slice(0, 1800) };
}

/** Ejecuta varios comandos en una sola sesión SSH (la consola tarda ~10 s en abrir). */
async function ejecutarVarios(router, cmds = []) {
  const lineas = cmds.map(construir);
  const salida = await ssh.ejecutar(router, lineas);
  const fallos = salida
    .split(/\r?\n/)
    .map((texto) => texto.trim())
    .filter((texto) => FALLO.test(texto));
  if (fallos.length) {
    return cmds.map(() => ({ ok: false, result: fallos[0].slice(0, 300) }));
  }
  return lineas.map((linea) => ({ ok: true, result: `SSH: ${ocultarSecretos(linea)}`.slice(0, 1800) }));
}

module.exports = { ejecutar, ejecutarVarios, construir, ocultarSecretos };
