const { Client } = require('ssh2');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { descifrar } = require('./cryptoService');

const ESPERA_PROMPT = 25000;
const ESPERA_COMANDO = 45000;

function limpiar(texto) {
  return String(texto || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
}

function conectar(router) {
  return new Promise((resolve, reject) => {
    const cliente = new Client();
    const password = descifrar(router.passwordEnc || '');
    const limite = setTimeout(() => {
      cliente.end();
      reject(new Error('Tiempo de espera agotado al conectar por SSH al router.'));
    }, 15000);
    cliente.once('ready', () => {
      clearTimeout(limite);
      resolve(cliente);
    });
    cliente.once('error', (error) => {
      clearTimeout(limite);
      reject(new Error(`SSH: ${error.message}`));
    });
    cliente.on('keyboard-interactive', (nombre, instrucciones, idioma, prompts, finish) => {
      finish(prompts.map(() => password));
    });
    cliente.connect({
      host: router.host,
      /* El puerto del modelo es el de la API; SSH usa el suyo. */
      port: Number(router.sshPort) || 22,
      username: router.username,
      password,
      readyTimeout: 12000,
      tryKeyboard: true,
    });
  });
}

/**
 * Abre una consola interactiva. RouterOS no acepta exec por SSH, así que se
 * escribe en la shell y se espera el marcador o el prompt.
 */
function sesion(cliente) {
  return new Promise((resolve, reject) => {
    cliente.shell({ term: 'vt100', cols: 240, rows: 400 }, (error, flujo) => {
      if (error) {
        cliente.end();
        reject(error);
        return;
      }
      let buffer = '';
      let licencia = false;
      const oyentes = [];

      const revisar = () => {
        if (!licencia && /software license\?/i.test(buffer)) {
          licencia = true;
          flujo.write('n\n');
        }
        oyentes.forEach((oyente) => {
          if (oyente.hecho) return;
          if (oyente.patron.test(buffer)) {
            oyente.hecho = true;
            clearTimeout(oyente.temporizador);
            oyente.listo(buffer);
          }
        });
      };

      flujo.on('data', (datos) => {
        buffer += limpiar(datos.toString('utf8'));
        revisar();
      });
      flujo.on('close', () => {
        oyentes.forEach((oyente) => {
          if (oyente.hecho) return;
          oyente.hecho = true;
          clearTimeout(oyente.temporizador);
          oyente.fallo(new Error('El router cerró la sesión SSH.'));
        });
      });

      const esperar = (patron, ms = ESPERA_COMANDO) =>
        new Promise((listo, fallo) => {
          if (patron.test(buffer)) {
            listo(buffer);
            return;
          }
          const oyente = { patron, hecho: false, listo, fallo, temporizador: null };
          oyente.temporizador = setTimeout(() => {
            oyente.hecho = true;
            fallo(new Error('Tiempo de espera agotado esperando la respuesta del router.'));
          }, ms);
          oyentes.push(oyente);
        });

      resolve({ flujo, esperar, texto: () => buffer, cerrar: () => cliente.end() });
    });
  });
}

/** Devuelve el bloque entre las dos marcas, sin las líneas de marca. */
function entre(texto, marca) {
  const inicio = texto.search(new RegExp(`^CT-INICIO-${marca}$`, 'm'));
  const fin = texto.search(new RegExp(`^CT-FIN-${marca}$`, 'm'));
  if (inicio === -1 || fin === -1 || fin < inicio) return '';
  return texto
    .slice(inicio, fin)
    .split('\n')
    .slice(1)
    .join('\n')
    .trim();
}

/** Quita ecos de la consola: el export empieza en la cabecera de RouterOS. */
function limpiarExport(texto) {
  const lineas = String(texto || '').split('\n');
  const inicio = lineas.findIndex((linea) => /^#\s*(\d{4}-\d{2}-\d{2}|system id|software id|model)/i.test(linea));
  return recortarConsola((inicio === -1 ? lineas : lineas.slice(inicio)).join('\n'));
}

/** Corta el eco del último comando y limpia los prefijos de prompt. */
function recortarConsola(texto) {
  const corte = String(texto || '').indexOf(':put "CT-FIN');
  const cuerpo = corte === -1 ? String(texto || '') : String(texto).slice(0, corte);
  return cuerpo
    .split('\n')
    .map((linea) => linea.replace(/\[[^\]]*\]\s*>\s*/g, '').trimEnd())
    .filter((linea) => !/^CT-(INICIO|FIN)-/.test(linea) && !/^\/import\b/.test(linea))
    .join('\n')
    .trim();
}

/** Exporta la configuración legible con `hide-sensitive`. */
async function exportar(router) {
  const cliente = await conectar(router);
  try {
    const consola = await sesion(cliente);
    await consola.esperar(/\]\s*>\s*$/m, ESPERA_PROMPT);
    const marca = Date.now().toString(36);
    consola.flujo.write(`:put "CT-INICIO-${marca}"\n`);
    consola.flujo.write('export hide-sensitive\n');
    consola.flujo.write(`:put "CT-FIN-${marca}"\n`);
    const texto = await consola.esperar(new RegExp(`^CT-FIN-${marca}$`, 'm'), 60000);
    consola.cerrar();
    const config = limpiarExport(entre(texto, marca));
    if (!config || config.length < 20) throw new Error('El router no devolvió la configuración.');
    return config;
  } catch (error) {
    cliente.end();
    throw error;
  }
}

/** Sube un `.rsc` por SFTP y lo importa. */
async function importar(router, nombre, contenido) {
  const cliente = await conectar(router);
  const archivo = `/ct-restore-${Date.now().toString(36)}.rsc`;
  try {
    await new Promise((resolve, reject) => {
      cliente.sftp((error, sftp) => {
        if (error) {
          reject(new Error(`SFTP: ${error.message}`));
          return;
        }
        const flujo = sftp.createWriteStream(archivo);
        flujo.once('error', reject);
        flujo.once('close', resolve);
        flujo.end(contenido);
      });
    });

    const consola = await sesion(cliente);
    await consola.esperar(/\]\s*>\s*$/m, ESPERA_PROMPT);
    const marca = Date.now().toString(36);
    consola.flujo.write(`:put "CT-INICIO-${marca}"\n`);
    consola.flujo.write(`/import file-name=${archivo} verbose=yes\n`);
    consola.flujo.write(`/file/remove [find name="${archivo.replace(/^\//, '')}"]\n`);
    consola.flujo.write(`:put "CT-FIN-${marca}"\n`);
    const texto = await consola.esperar(new RegExp(`^CT-FIN-${marca}$`, 'm'), 120000);
    consola.cerrar();

    const salida = recortarConsola(entre(texto, marca)).slice(0, 4000);
    return {
      ok: !/(^|\n)\s*(failure|error|script error|bad command|syntax error)/i.test(salida),
      salida: salida || 'Importación terminada sin mensajes.',
    };
  } finally {
    cliente.end();
  }
}

/** Ejecuta comandos en la consola y devuelve la salida. */
async function ejecutar(router, comandos) {
  const cliente = await conectar(router);
  try {
    const consola = await sesion(cliente);
    await consola.esperar(/\]\s*>\s*$/m, ESPERA_PROMPT);
    const marca = Date.now().toString(36);
    consola.flujo.write(`:put "CT-INICIO-${marca}"\n`);
    for (const comando of comandos) consola.flujo.write(`${comando}\n`);
    consola.flujo.write(`:put "CT-FIN-${marca}"\n`);
    const texto = await consola.esperar(new RegExp(`^CT-FIN-${marca}$`, 'm'), 40000);
    consola.cerrar();
    return recortarConsola(entre(texto, marca));
  } finally {
    cliente.end();
  }
}

/** Respaldo binario `.backup` del equipo, descargado por SFTP. */
async function exportarBinario(router) {
  const cliente = await conectar(router);
  const base = `ct-backup-${Date.now().toString(36)}`;
  const nombreRemoto = `${base}.backup`;
  const local = path.join(os.tmpdir(), nombreRemoto);

  try {
    const consola = await sesion(cliente);
    await consola.esperar(/\]\s*>\s*$/m, ESPERA_PROMPT);
    consola.flujo.write(`/system backup save name=${base} dont-encrypt=yes\n`);
    await new Promise((listo) => setTimeout(listo, 4000));

    let buffer = null;
    for (let intento = 0; intento < 3 && !buffer; intento += 1) {
      try {
        await new Promise((resolve, reject) => {
          cliente.sftp((error, sftp) => {
            if (error) return reject(new Error(`SFTP: ${error.message}`));
            sftp.fastGet(nombreRemoto, local, (fallo) => (fallo ? reject(fallo) : resolve()));
          });
        });
        buffer = fs.readFileSync(local);
      } catch (error) {
        await new Promise((listo) => setTimeout(listo, 1500));
      }
    }
    if (!buffer) throw new Error('El router no generó el respaldo binario.');

    await new Promise((resolve) => {
      cliente.sftp((error, sftp) => {
        if (error) return resolve();
        sftp.unlink(nombreRemoto, () => resolve());
      });
    });

    return { buffer, nombre: nombreRemoto };
  } finally {
    try {
      fs.unlinkSync(local);
    } catch (error) {
      /* el archivo temporal ya no existe */
    }
    cliente.end();
  }
}

/** Sube un `.backup` por SFTP y lo carga en el equipo (el router se reinicia). */
async function cargarBinario(router, buffer) {
  const cliente = await conectar(router);
  const archivo = `/ct-restore-${Date.now().toString(36)}.backup`;
  const nombre = archivo.replace(/^\//, '');
  try {
    await new Promise((resolve, reject) => {
      cliente.sftp((error, sftp) => {
        if (error) {
          reject(new Error(`SFTP: ${error.message}`));
          return;
        }
        const flujo = sftp.createWriteStream(archivo);
        flujo.once('error', reject);
        flujo.once('close', resolve);
        flujo.end(buffer);
      });
    });

    const consola = await sesion(cliente);
    await consola.esperar(/\]\s*>\s*$/m, ESPERA_PROMPT);
    consola.flujo.write(`/system backup load name=${nombre} password=""\n`);

    let aviso = '';
    try {
      aviso = await consola.esperar(/\[y\/N\]/i, 20000);
    } catch (error) {
      aviso = '';
    }
    if (/\[y\/N\]/i.test(aviso)) {
      consola.flujo.write('y\n');
      await new Promise((listo) => setTimeout(listo, 6000));
      consola.cerrar();
      return { ok: true, salida: 'Respaldo binario cargado. El equipo se reinicia; espera un minuto antes de reconectar.' };
    }
    consola.cerrar();
    return { ok: false, salida: recortarConsola(aviso) || 'El router no pidió confirmación para cargar el respaldo.' };
  } finally {
    cliente.end();
  }
}

module.exports = { exportar, importar, exportarBinario, cargarBinario, ejecutar };