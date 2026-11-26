const { descifrar } = require('./cryptoService');

let parcheado = false;

/**
 * RouterOS 7 devuelve `!empty` cuando una consulta no tiene filas, pero
 * node-routeros 1.6.x no lo reconoce y lanza una excepción fuera de control.
 * Aquí lo tratamos como un resultado vacío para que los lookup no rompan.
 */
function parchearChannel(Channel) {
  if (parcheado) return;
  parcheado = true;
  Channel.prototype.onUnknown = function onUnknown(reply) {
    if (reply === '!empty') {
      this.emit('done', this.data || []);
      return;
    }
    throw new Error(`UNKNOWNREPLY ${reply}`);
  };
}

/**
 * Tras `!empty`, RouterOS manda el `!done` de esa misma consulta y el
 * receptor ya descartó el tag. node-routeros lanza `UNREGISTEREDTAG` desde un
 * callback de socket, lo que tumba el proceso; aquí se ignora ese resto.
 */
function parchearReceiver(Receiver) {
  if (Receiver.prototype.__parcheado) return;
  Receiver.prototype.__parcheado = true;
  const original = Receiver.prototype.sendTagData;
  Receiver.prototype.sendTagData = function sendTagData(currentTag) {
    if (!this.tags.get(currentTag)) {
      this.cleanUp();
      return;
    }
    original.call(this, currentTag);
  };
}

/**
 * Capa fina sobre la API RouterOS (node-routeros).
 * Solo se usa en modo real; el modo simulado nunca abre una conexión.
 */
function cargarApi() {
  try {
    // Dependencia opcional: solo se necesita en modo real.
    const { RouterOSAPI, Channel, Receiver } = require('node-routeros');
    parchearChannel(Channel);
    parchearReceiver(Receiver);
    if (!RouterOSAPI.__ctSeguro) {
      /* node-routeros deja conexiones sin listener y un socket caído tumba el proceso. */
      const Original = RouterOSAPI;
      const Seguro = class RouterOSSeguro extends Original {
        constructor(...args) {
          super(...args);
          this.on('error', (error) => {
            console.error('⚠️  Conexión RouterOS interrumpida:', error && error.message ? error.message : 'socket cerrado');
          });
        }
      };
      Seguro.__ctSeguro = true;
      return Seguro;
    }
    return RouterOSAPI;
  } catch (error) {
    throw new Error('No se pudo cargar el controlador de RouterOS (node-routeros). Reinstala las dependencias con npm install.');
  }
}

function datosConexion(router) {
  const config = router.firewall || router;
  if (!config.host || !config.username) {
    throw new Error('Faltan el host y el usuario de la API del router.');
  }
  return {
    host: config.host,
    user: config.username,
    password: descifrar(config.passwordEnc || ''),
    port: config.port || 8728,
    timeout: 10,
    tls: config.tls ? { rejectUnauthorized: config.verifyTls === true } : undefined,
  };
}

/**
 * RouterOS acepta pocas conexiones API simultáneas (el CHR bajo QEMU incluso
 * avisa "possible SYN flooding" y empieza a perder logins). Limitamos las
 * conexiones por router y reintentamos solo los fallos transitorios; un
 * usuario o clave incorrectos no se reintentan.
 */
const MAX_CONEXIONES = Math.max(2, Number(process.env.ROUTEROS_MAX_CONEXIONES) || 2);
const MAX_COLA = Math.max(10, Number(process.env.ROUTEROS_MAX_COLA) || 50);
const REINTENTOS = Math.max(1, Number(process.env.ROUTEROS_REINTENTOS) || 3);
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const colas = new Map();

function claveRouter(router) {
  const config = router.firewall || router;
  return `${config.host}:${config.port || 8728}:${config.username}`;
}

function estadoCola(clave) {
  if (!colas.has(clave)) colas.set(clave, { activas: 0, cola: [] });
  return colas.get(clave);
}

function tomarTurno(clave) {
  const estado = estadoCola(clave);
  if (estado.activas < MAX_CONEXIONES) {
    estado.activas += 1;
    return Promise.resolve();
  }
  if (estado.cola.length >= MAX_COLA) {
    const error = new Error('El router tiene demasiadas operaciones en cola. Intenta de nuevo en unos segundos.');
    error.status = 503;
    error.esOperacional = true;
    return Promise.reject(error);
  }
  return new Promise((resolve) => estado.cola.push(resolve));
}

function liberarTurno(clave) {
  const estado = colas.get(clave);
  if (!estado) return;
  const siguiente = estado.cola.shift();
  if (siguiente) {
    /* El turno pasa directo al siguiente; el contador no cambia. */
    siguiente();
    return;
  }
  estado.activas = Math.max(0, estado.activas - 1);
  if (!estado.activas) colas.delete(clave);
}

function transitorio(error) {
  const texto = `${(error && error.message) || ''} ${(error && error.code) || ''}`;
  /* Clave incorrecta, host caído y timeouts no se reintentan. Los errores
     sin detalle o los cortes de socket sí: suelen ser transitorios. */
  if (/cannot log in|invalid user|bad password|no such user|authentication|not permitted|timed out|timeout|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(texto)) {
    return false;
  }
  return true;
}

async function conectar(router) {
  const RouterOSAPI = cargarApi();
  const config = router.firewall || router;
  const llave = claveRouter(router);
  await tomarTurno(llave);

  let conexion = null;
  let ultimoError = null;
  try {
    for (let intento = 0; intento < REINTENTOS; intento += 1) {
      conexion = new RouterOSAPI(datosConexion(router));
      conexion.__ctLlave = llave;
      try {
        await conexion.connect();
        return conexion;
      } catch (error) {
        ultimoError = error;
        try { conexion.close(); } catch (cierre) { /* ya cerrada */ }
        conexion = null;
        if (intento >= REINTENTOS - 1 || !transitorio(error)) break;
        await esperar(250 * (intento + 1) + Math.floor(Math.random() * 150));
      }
    }

    /* node-routeros pierde el motivo de OpenSSL: al menos se orienta al usuario. */
    const pista = config.tls
      ? 'No se pudo abrir la sesión TLS (api-ssl). Comprueba que el servicio tenga un certificado asignado y, si es autofirmado, deja sin marcar «verificar certificado».'
      : 'No se pudo abrir la sesión API. Comprueba host, puerto, usuario y que el servicio api esté habilitado.';
    const motivo = (ultimoError && (ultimoError.message || ultimoError.code)) ? ` (${ultimoError.message || ultimoError.code})` : '';
    throw new Error(`${pista} Destino ${config.host}:${config.port || 8728}${motivo}.`, { cause: ultimoError });
  } catch (error) {
    liberarTurno(llave);
    throw error;
  }
}

function cerrar(conexion) {
  if (!conexion) return;
  const llave = conexion.__ctLlave;
  conexion.__ctLlave = null;
  try {
    conexion.close();
  } catch (error) {
    /* la conexión ya estaba cerrada */
  }
  if (llave) liberarTurno(llave);
}

async function buscarId(conexion, lookup) {
  const filas = await conexion.write(lookup.path, lookup.filters || []);
  if (!filas || !filas.length) return null;
  return filas[0]['.id'];
}

/**
 * Ejecuta un comando RouterOS sobre una conexión ya abierta (lookup + cambio).
 * Un comando con `upsert: true` cambia add↔set según exista o no el objeto.
 */
async function ejecutarCon(conexion, cmd) {
  let path = cmd.path;
  let params = [...(cmd.params || [])];

  if (cmd.lookup) {
    const id = await buscarId(conexion, cmd.lookup);
    const esAdd = /\/add$/.test(path);
    const esSet = /\/set$/.test(path);
    const esRemove = /\/remove$/.test(path);

    if (id) {
      if (esAdd && cmd.upsert) path = path.replace(/\/add$/, '/set');
      else if (esAdd) return { ok: true, result: 'El objeto ya existía; no se modificó.' };
      if (path.endsWith('/set') && cmd.paramsSet) params = [...cmd.paramsSet];
      if (esRemove || esSet || (esAdd && cmd.upsert)) params.push(`=.id=${id}`);
    } else if (esRemove) {
      return { ok: true, result: 'El objeto no existía; nada que eliminar.' };
    } else if (!esAdd) {
      /* Un /set sin objeto no se convierte en /add: crearía un objeto
         incompleto (sin cadena, nombre, etc.). Se falla de forma visible. */
      return { ok: false, result: 'El objeto no existe en el router.' };
    }
  }

  const respuesta = await conexion.write(path, params);
  return { ok: true, result: JSON.stringify(respuesta ?? { ok: true }).slice(0, 1800) };
}

/** Ejecuta un comando RouterOS con una sola conexión (lookup + cambio). */
async function ejecutar(router, cmd) {
  /* Modo emergencia: todo el aprovisionamiento va por consola SSH. */
  if (router.transport === 'ssh') {
    const mikrotikCli = require('./mikrotikCli');
    const config = router.firewall || router;
    if (!config.host || !config.username) {
      throw new Error('Faltan el host y el usuario para la consola SSH.');
    }
    return mikrotikCli.ejecutar(config, cmd);
  }

  const conexion = await conectar(router);
  try {
    return await ejecutarCon(conexion, cmd);
  } finally {
    cerrar(conexion);
  }
}

/**
 * Ejecuta varios comandos con una sola conexión. En SSH evita pagar los ~10 s
 * de apertura de consola por cada paso del aprovisionamiento.
 */
async function ejecutarVarios(router, cmds = []) {
  if (!cmds.length) return [];

  if (router.transport === 'ssh') {
    const mikrotikCli = require('./mikrotikCli');
    const config = router.firewall || router;
    if (!config.host || !config.username) {
      throw new Error('Faltan el host y el usuario para la consola SSH.');
    }
    return mikrotikCli.ejecutarVarios(config, cmds);
  }

  const conexion = await conectar(router);
  try {
    const resultados = [];
    for (const cmd of cmds) {
      const resultado = await ejecutarCon(conexion, cmd);
      resultados.push(resultado);
      if (!resultado.ok) break;
    }
    return resultados;
  } finally {
    cerrar(conexion);
  }
}

module.exports = { cargarApi, conectar, cerrar, ejecutar, ejecutarVarios, buscarId };
