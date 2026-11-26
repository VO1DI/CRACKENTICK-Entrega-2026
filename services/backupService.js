const RouterBackup = require('../models/RouterBackup');
const mikrotikSsh = require('./mikrotikSsh');
const ciscoService = require('./ciscoService');
const { cifrarBuffer, descifrarBuffer } = require('./cryptoService');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');

const MAXIMO_BYTES = 4 * 1024 * 1024;
const MAX_RESPALDOS_POR_ROUTER = 30;

function errorCanalSsh(router, error, accion = 'respaldar') {
  if (error && error.status) return error;
  return crearError(
    502,
    `No se pudo ${accion} ${router.name} por SSH (${router.host}:${router.sshPort || 22}). ` +
      'Habilita /ip/service ssh en el router o usa un equipo con SSH; no se guardó ningún respaldo. ' +
      `Detalle: ${error && error.message ? error.message : 'conexión rechazada'}.`
  );
}

function nombreArchivo(router, formato) {
  const slug = String(router.name || 'router')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const ahora = new Date();
  const sello = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}-${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}`;
  return `respaldo-${slug || 'router'}-${sello}.${formato}`;
}

function encabezadoSimulado(router) {
  return [
    '# Respaldo simulado de CRACKENTICK',
    `# Router: ${router.name}`,
    `# Host: ${router.host || 'sin host'}`,
    `# Fecha: ${new Date().toISOString()}`,
    '# Este router está en modo simulado: no se leyó la configuración real.',
    '# Cambia el modo a real para generar un respaldo del equipo.',
  ].join('\n');
}

/** Copia lógica por API para routers sin SSH. No es restaurable automáticamente. */
async function respaldoLogico(router) {
  const routeros = require('./routeros');
  const api = await routeros.conectar(router);
  const secciones = [
    ['Identidad', '/system/identity/print'],
    ['Interfaces', '/interface/print'],
    ['Direcciones IP', '/ip/address/print'],
    ['Rutas', '/ip/route/print'],
    ['Firewall', '/ip/firewall/filter/print'],
    ['Mangle', '/ip/firewall/mangle/print'],
    ['NAT', '/ip/firewall/nat/print'],
    ['Secretos PPP', '/ppp/secret/print'],
    ['Colas simples', '/queue/simple/print'],
    ['Pools IP', '/ip/pool/print'],
    ['Servidores DHCP', '/ip/dhcp-server/print'],
    ['VLANs', '/interface/vlan/print'],
  ];
  const partes = [
    '# Respaldo lógico de CRACKENTICK (solo consulta, no restaurable automáticamente)',
    `# Router: ${router.name}`,
    `# Host: ${router.host || 'sin host'}`,
    `# Fecha: ${new Date().toISOString()}`,
    '',
  ];
  try {
    for (const [titulo, path] of secciones) {
      try {
        const filas = await api.write(path);
        const limpias = (filas || []).map((fila) => {
          const copia = { ...fila };
          for (const clave of Object.keys(copia)) {
            if (/password|secret|passphrase|private|key/i.test(clave)) copia[clave] = '***';
          }
          return copia;
        });
        partes.push(`# ${titulo}`, ...limpias.map((fila) => JSON.stringify(fila)), '');
      } catch (error) {
        partes.push(`# ${titulo}: error al leer (${error.message})`, '');
      }
    }
  } finally {
    routeros.cerrar(api);
  }
  return partes.join('\n');
}

async function listarTodos() {
  return RouterBackup.find({}).sort({ routerId: 1, createdAt: -1 }).select('-content -binary').lean();
}

async function listar(routerId) {
  return RouterBackup.find({ routerId }).sort({ createdAt: -1 }).select('-content -binary').lean();
}

async function recortarRespaldos(routerId) {
  const sobran = await RouterBackup.find({ routerId })
    .sort({ createdAt: -1 })
    .skip(MAX_RESPALDOS_POR_ROUTER)
    .select('_id')
    .lean();
  if (sobran.length) {
    await RouterBackup.deleteMany({ _id: { $in: sobran.map((fila) => fila._id) } });
  }
}

async function crear(router, { actor = 'admin', binario = false } = {}) {
  if (binario) {
    if (router.vendor !== 'mikrotik') {
      throw crearError(422, 'El respaldo binario solo existe en MikroTik.');
    }
    if (router.mode !== 'real') {
      throw crearError(422, 'El respaldo binario necesita un router en modo real.');
    }
    let salida;
    try {
      salida = await mikrotikSsh.exportarBinario(router);
    } catch (error) {
      throw errorCanalSsh(router, error);
    }
    if (salida.buffer.length > MAXIMO_BYTES) {
      throw crearError(413, 'El respaldo binario supera 4 MB; descárgalo manualmente desde el router.');
    }
    const respaldo = await RouterBackup.create({
      routerId: router._id,
      routerName: router.name,
      name: nombreArchivo(router, 'backup'),
      format: 'backup',
      size: salida.buffer.length,
      binary: cifrarBuffer(salida.buffer),
      simulated: false,
      actor,
    });
    await registrar({
      module: 'provisioning',
      entity: 'RouterBackup',
      entityId: respaldo._id,
      action: 'create',
      description: `Respaldo binario ${respaldo.name} de ${router.name} (${Math.round(salida.buffer.length / 1024)} KB).`,
      commandResult: '/system backup save',
      actor,
    });
    await recortarRespaldos(router._id);
    return respaldo;
  }

  let formato = router.vendor === 'cisco' ? 'ios' : 'rsc';
  let contenido;

  if (router.mode !== 'real') {
    contenido = encabezadoSimulado(router);
  } else if (router.vendor === 'cisco') {
    contenido = await ciscoService.respaldar(router);
  } else {
    try {
      contenido = await mikrotikSsh.exportar(router);
    } catch (error) {
      /* Sin SSH se guarda una copia lógica por API, marcada como no restaurable. */
      try {
        contenido = await respaldoLogico(router);
        formato = 'api';
      } catch (respaldoError) {
        throw errorCanalSsh(router, error);
      }
    }
  }

  if (!contenido || contenido.length < 20) {
    throw crearError(502, 'El router no devolvió una configuración utilizable.');
  }
  const tamano = Buffer.byteLength(contenido, 'utf8');
  if (tamano > MAXIMO_BYTES) {
    throw crearError(413, 'La configuración supera 4 MB; usa un respaldo binario manual.');
  }

  const respaldo = await RouterBackup.create({
    routerId: router._id,
    routerName: router.name,
    name: nombreArchivo(router, formato),
    format: formato,
    size: tamano,
    content: contenido,
    simulated: router.mode !== 'real',
    actor,
  });

  await registrar({
    module: 'provisioning',
    entity: 'RouterBackup',
    entityId: respaldo._id,
    action: 'create',
    description: `Respaldo ${respaldo.name} de ${router.name} (${Math.round(tamano / 1024)} KB).`,
    commandResult: `${contenido.split('\n').length} líneas`,
    actor,
  });

  await recortarRespaldos(router._id);
  return respaldo;
}

async function eliminar(respaldo, { actor = 'admin' } = {}) {
  await respaldo.deleteOne();
  await registrar({
    module: 'provisioning',
    entity: 'RouterBackup',
    entityId: respaldo._id,
    action: 'delete',
    description: `Respaldo ${respaldo.name} eliminado.`,
    changes: { before: { name: respaldo.name, size: respaldo.size } },
    actor,
  });
}

/** Carga un respaldo al equipo. Solo MikroTik: Cisco se restaura a mano. */
async function restaurar(respaldo, router, { actor = 'admin' } = {}) {
  if (respaldo.simulated) {
    throw crearError(422, 'Este respaldo es simulado y no contiene la configuración del equipo.');
  }
  if (respaldo.format === 'api') {
    throw crearError(422, 'El respaldo lógico es solo de consulta: descárgalo, pero no se restaura automáticamente.');
  }
  if (respaldo.format === 'backup') {
    if (router.vendor !== 'mikrotik') {
      throw crearError(422, 'El respaldo binario solo se carga en MikroTik.');
    }
    if (!respaldo.binary || !respaldo.binary.length) {
      throw crearError(422, 'El respaldo binario está vacío.');
    }
    const binario = descifrarBuffer(respaldo.binary);
    if (!binario || !binario.length) {
      throw crearError(422, 'El respaldo binario está vacío o no se pudo descifrar.');
    }
    const inicioBinario = Date.now();
    let resultadoBinario;
    try {
      resultadoBinario = await mikrotikSsh.cargarBinario(router, binario);
    } catch (error) {
      throw errorCanalSsh(router, error, 'restaurar');
    }
    await registrar({
      module: 'provisioning',
      entity: 'RouterBackup',
      entityId: respaldo._id,
      action: 'provision',
      description: `Respaldo binario ${respaldo.name} cargado en ${router.name}.`,
      command: '/system backup load',
      commandResult: String(resultadoBinario.salida || '').slice(0, 1900),
      status: resultadoBinario.ok ? 'success' : 'failed',
      durationMs: Date.now() - inicioBinario,
      actor,
    });
    return { ...resultadoBinario, simulado: false, reinicia: true, durationMs: Date.now() - inicioBinario };
  }
  if (router.mode !== 'real') {
    return { ok: true, simulado: true, salida: 'Restauración simulada: no se abrió conexión.' };
  }
  if (router.vendor === 'cisco') {
    throw crearError(422, 'La carga automática solo está disponible en MikroTik. En Cisco descarga el archivo y aplícalo por consola.');
  }

  const inicio = Date.now();
  let resultado;
  try {
    resultado = await mikrotikSsh.importar(router, 'crackentick', respaldo.content);
  } catch (error) {
    throw errorCanalSsh(router, error, 'restaurar');
  }

  await registrar({
    module: 'provisioning',
    entity: 'RouterBackup',
    entityId: respaldo._id,
    action: 'provision',
    description: `Respaldo ${respaldo.name} cargado en ${router.name}.`,
    command: `/import ${respaldo.name}`,
    commandResult: String(resultado.salida || '').slice(0, 1900),
    status: resultado.ok ? 'success' : 'failed',
    durationMs: Date.now() - inicio,
    actor,
  });

  return { ...resultado, simulado: false, durationMs: Date.now() - inicio };
}

module.exports = { listar, listarTodos, crear, eliminar, restaurar, nombreArchivo };
