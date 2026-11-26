const { Client } = require('ssh2');
const { descifrar } = require('./cryptoService');

const ERROR_CLI = /%\s*(Invalid input|Incomplete command|Ambiguous command|Unknown command|Authorization failed|Command rejected)/i;

function conectar(router) {
  return new Promise((resolve, reject) => {
    const cliente = new Client();
    const limite = setTimeout(() => {
      cliente.end();
      reject(new Error('Tiempo de espera agotado al conectar por SSH.'));
    }, 12000);
    cliente.once('ready', () => {
      clearTimeout(limite);
      resolve(cliente);
    });
    cliente.once('error', (error) => {
      clearTimeout(limite);
      reject(error);
    });
    const password = descifrar(router.passwordEnc || '');
    cliente.on('keyboard-interactive', (nombre, instrucciones, idioma, prompts, finish) => {
      finish(prompts.map(() => password));
    });
    cliente.connect({
      host: router.host,
      port: Number(router.port) || 22,
      username: router.username,
      password,
      readyTimeout: 10000,
      tryKeyboard: true,
    });
  });
}

function limpiarSalida(texto) {
  return String(texto || '')
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, 8000);
}

/** Ejecuta comandos CLI por SSH. `config: true` entra en modo configuración. */
async function ejecutar(router, comandos, { config = true } = {}) {
  const cliente = await conectar(router);
  const enablePassword = descifrar(router.enablePasswordEnc || '');

  return new Promise((resolve, reject) => {
    cliente.shell({ term: 'vt100', cols: 200, rows: 1000 }, (error, flujo) => {
      if (error) {
        cliente.end();
        reject(error);
        return;
      }

      let salida = '';
      let finalizado = false;
      const terminar = () => {
        if (finalizado) return;
        finalizado = true;
        cliente.end();
        const texto = limpiarSalida(salida);
        resolve({ ok: !ERROR_CLI.test(texto), result: texto });
      };

      flujo.on('data', (datos) => {
        salida += datos.toString('utf8');
      });
      if (flujo.stderr) {
        flujo.stderr.on('data', (datos) => {
          salida += datos.toString('utf8');
        });
      }
      flujo.on('close', terminar);

      const enviar = (texto, espera) =>
        new Promise((listo) => {
          setTimeout(() => {
            flujo.write(`${texto}\n`);
            listo();
          }, espera);
        });

      (async () => {
        await enviar('terminal length 0', 250);
        if (config) {
          await enviar('enable', 500);
          if (enablePassword && /password\s*:/i.test(salida)) await enviar(enablePassword, 500);
          await enviar('configure terminal', 500);
          for (const comando of comandos) await enviar(comando, 300);
          await enviar('end', 500);
        } else {
          for (const comando of comandos) await enviar(comando, 800);
        }
        setTimeout(terminar, 700);
      })().catch((fallo) => {
        cliente.end();
        reject(fallo);
      });
    });
  });
}

async function probar(router) {
  const inicio = Date.now();
  const resultado = await ejecutar(router, ['show version | include Version'], { config: false });
  return {
    ok: resultado.ok,
    command: 'show version | include Version',
    result: resultado.result.slice(0, 500),
    simulated: false,
    durationMs: Date.now() - inicio,
  };
}

async function respaldar(router) {
  const resultado = await ejecutar(router, ['show running-config'], { config: false });
  if (!resultado.ok) throw new Error(resultado.result.slice(0, 400) || 'No se pudo leer la configuración.');
  return resultado.result;
}

module.exports = { ejecutar, probar, respaldar };
