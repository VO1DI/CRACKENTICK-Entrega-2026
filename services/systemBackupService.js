const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const Settings = require('../models/Settings');
const { registrar } = require('./auditService');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const RCLONE = () => process.env.RCLONE_PATH || 'rclone';

let trabajo = null;
let programado = false;

function estado() {
  if (!trabajo) return { estado: 'inactivo', porcentaje: 0, mensaje: 'Sin respaldo en curso.', archivo: '', iniciado: null, error: '' };
  return trabajo;
}

function ejecutar(comando, args, { onLine, timeoutMs = 2 * 60 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(comando, args, { windowsHide: true });
    let salida = '';
    let terminado = false;
    const reloj = setTimeout(() => {
      if (terminado) return;
      terminado = true;
      try { hijo.kill(); } catch (error) { /* ya terminó */ }
      reject(new Error(`${comando} no respondió en ${Math.round(timeoutMs / 60000)} minutos.`));
    }, timeoutMs);
    const leer = (dato) => {
      const texto = dato.toString();
      salida += texto;
      if (onLine) {
        texto.split(/\r?\n/).forEach((linea) => {
          if (linea.trim()) onLine(linea);
        });
      }
    };
    hijo.stdout.on('data', leer);
    hijo.stderr.on('data', leer);
    hijo.on('error', (error) => {
      clearTimeout(reloj);
      if (terminado) return;
      terminado = true;
      reject(new Error(`${comando}: ${error.message}`));
    });
    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      if (terminado) return;
      terminado = true;
      if (codigo === 0) resolve(salida);
      else reject(new Error(salida.trim().slice(-500) || `${comando} terminó con código ${codigo}`));
    });
  });
}

/** Vuelca una colección con cursor para no cargarla entera en memoria. */
async function exportarColeccion(db, nombre, archivo) {
  const cursor = db.collection(nombre).find({});
  const salida = fs.createWriteStream(archivo);
  const terminado = new Promise((resolve, reject) => {
    salida.once('finish', resolve);
    salida.once('error', reject);
  });
  let total = 0;
  let primero = true;
  salida.write('[');
  for await (const documento of cursor) {
    if (!primero) salida.write(',');
    primero = false;
    const texto = EJSON.stringify(documento, null, 0, { relaxed: false });
    if (!salida.write(texto)) {
      await new Promise((resolve, reject) => {
        const alDrenar = () => {
          salida.off('error', alFallar);
          resolve();
        };
        const alFallar = (error) => {
          salida.off('drain', alDrenar);
          reject(error);
        };
        salida.once('drain', alDrenar);
        salida.once('error', alFallar);
      });
    }
    total += 1;
  }
  salida.end(']');
  await terminado;
  return total;
}

async function ejecutarRespaldo(settings, actor) {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'ct-sysbackup-'));
  const dump = path.join(base, 'dump');
  await fsp.mkdir(dump, { recursive: true });
  const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const archivo = path.join(base, `crackentick-${sello}.tar.gz`);
  const config = settings.backup || {};

  try {
    const db = mongoose.connection.db;
    const colecciones = (await db.listCollections().toArray())
      .map((coleccion) => coleccion.name)
      /* Las sesiones son efímeras: no se respaldan para no filtrar cookies válidas. */
      .filter((nombre) => !nombre.startsWith('system.') && nombre !== 'sessions')
      .sort();
    const resumen = {};

    trabajo.estado = 'dump';
    trabajo.mensaje = `Exportando base de datos (${colecciones.length} colecciones)…`;
    for (let i = 0; i < colecciones.length; i += 1) {
      const total = await exportarColeccion(db, colecciones[i], path.join(dump, `${colecciones[i]}.json`));
      resumen[colecciones[i]] = total;
      trabajo.porcentaje = 5 + Math.round(((i + 1) / colecciones.length) * 40);
      trabajo.mensaje = `Exportando ${colecciones[i]} (${i + 1}/${colecciones.length})…`;
    }

    await fsp.writeFile(
      path.join(dump, 'manifest.json'),
      JSON.stringify({ app: 'CRACKENTICK', generado: new Date().toISOString(), colecciones: resumen }, null, 2),
      'utf8'
    );

    trabajo.estado = 'zip';
    trabajo.porcentaje = 50;
    trabajo.mensaje = 'Comprimiendo respaldo…';
    await ejecutar('tar', ['-czf', archivo, '-C', dump, '.']);

    const ahora = new Date();
    const destino = `${config.remote || 'gdrive'}:${config.folder || 'CRACKENTICK-RESPALDOS'}/${MESES[ahora.getMonth()]}-${ahora.getFullYear()}`;
    trabajo.estado = 'subida';
    trabajo.porcentaje = 60;
    trabajo.mensaje = `Subiendo a ${destino}…`;
    await ejecutar(RCLONE(), ['copy', archivo, destino, '--stats-one-line', '--stats', '1s'], {
      onLine: (linea) => {
        const avance = /(\d+)%/.exec(linea);
        if (avance) trabajo.porcentaje = Math.min(99, 60 + Math.round(Number(avance[1]) * 0.38));
      },
    });

    trabajo.estado = 'listo';
    trabajo.porcentaje = 100;
    trabajo.mensaje = 'Respaldo completado.';
    trabajo.archivo = `${destino}/${path.basename(archivo)}`;

    settings.backup.lastRunAt = new Date();
    settings.backup.lastResult = `OK · ${trabajo.archivo}`;
    settings.backup.lastFile = trabajo.archivo;
    await settings.save();

    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'provision',
      description: `Respaldo del sistema subido a ${trabajo.archivo}.`,
      commandResult: Object.entries(resumen).map(([nombre, total]) => `${nombre}: ${total}`).join('\n').slice(0, 1900),
      status: 'success',
      actor,
    });
  } catch (error) {
    trabajo.estado = 'error';
    trabajo.mensaje = 'Falló el respaldo del sistema.';
    trabajo.error = error.message;
    settings.backup.lastResult = `ERROR · ${error.message}`.slice(0, 300);
    await settings.save().catch(() => null);
    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'provision',
      description: 'Falló el respaldo del sistema.',
      commandResult: error.message.slice(0, 1900),
      status: 'failed',
      actor,
    }).catch(() => null);
  } finally {
    await fsp.rm(base, { recursive: true, force: true }).catch(() => null);
  }
}

/** Inicia un respaldo en segundo plano y devuelve el estado del trabajo. */
async function crear({ actor = 'system' } = {}) {
  if (trabajo && ['dump', 'zip', 'subida'].includes(trabajo.estado)) {
    const error = new Error('Ya hay un respaldo en curso.');
    error.status = 409;
    throw error;
  }
  trabajo = {
    estado: 'dump',
    porcentaje: 2,
    mensaje: 'Preparando respaldo…',
    archivo: '',
    iniciado: new Date().toISOString(),
    error: '',
  };
  try {
    const settings = await Settings.getSingleton();
    ejecutarRespaldo(settings, actor).catch((error) => {
      trabajo.estado = 'error';
      trabajo.error = error.message;
    });
  } catch (error) {
    /* Sin configuración no hay trabajo: no se deja el estado bloqueado. */
    trabajo.estado = 'error';
    trabajo.error = error.message;
    throw error;
  }
  return estado();
}

/** Comprueba que rclone puede autenticarse contra el remoto configurado. */
async function probarConexion() {
  const settings = await Settings.getSingleton();
  const config = settings.backup || {};
  await ejecutar(RCLONE(), ['lsd', `${config.remote || 'gdrive'}:`, '--max-depth', '1']);
  return { ok: true };
}

/** Revisa cada minuto si toca el respaldo semanal configurado. */
function programar() {
  if (programado) return;
  programado = true;
  const temporizador = setInterval(async () => {
    try {
      const settings = await Settings.getSingleton();
      const config = settings.backup || {};
      if (!config.enabled) return;
      const ahora = new Date();
      if (ahora.getDay() !== Number(config.dayOfWeek)) return;
      if (ahora.getHours() !== Number(config.hour)) return;
      if (config.lastRunAt) {
        const ultimo = new Date(config.lastRunAt);
        if (ultimo.toDateString() === ahora.toDateString()) return;
      }
      if (trabajo && ['dump', 'zip', 'subida'].includes(trabajo.estado)) return;
      await crear({ actor: 'scheduler' });
    } catch (error) {
      console.error('Respaldo programado:', error.message);
    }
  }, 60 * 1000);
  temporizador.unref();
}

module.exports = { crear, estado, probarConexion, programar, exportarColeccion };
