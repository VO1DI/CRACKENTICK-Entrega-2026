/**
 * Simulador mínimo de consola Cisco IOS por SSH para pruebas de integración.
 * No sustituye a un IOS real: emula los comandos que usa CRACKENTICK.
 *
 * Uso: node pruebas/cisco-sim/server.js
 */
const { Server } = require('ssh2');
const { generateKeyPairSync } = require('node:crypto');

const COMANDOS = [];
let servidor = null;
let clientes = [];

function generarClave() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

function responder(linea, estado, stream) {
  const texto = linea.trim();
  if (texto) COMANDOS.push(texto);
  let salida = '';

  if (!texto) return stream.write(`${estado.prompt} `);
  if (texto === 'enable') {
    estado.modo = 'exec';
    estado.prompt = 'Router#';
    return stream.write(`${estado.prompt} `);
  }
  if (texto === 'terminal length 0') return stream.write(`${estado.prompt} `);
  if (texto === 'configure terminal') {
    estado.modo = 'config';
    estado.prompt = 'Router(config)#';
    return stream.write(`${estado.prompt} `);
  }
  if (texto === 'end') {
    estado.modo = 'exec';
    estado.prompt = 'Router#';
    return stream.write(`${estado.prompt} `);
  }
  if (texto === 'exit') {
    if (estado.modo === 'config-vlan' || estado.modo === 'config-if') {
      estado.modo = 'config';
      estado.prompt = 'Router(config)#';
    }
    return stream.write(`${estado.prompt} `);
  }
  if (/^vlan \d+$/.test(texto)) {
    estado.modo = 'config-vlan';
    estado.prompt = 'Router(config-vlan)#';
    return stream.write(`${estado.prompt} `);
  }
  if (/^name /.test(texto)) return stream.write(`${estado.prompt} `);
  if (/^interface /.test(texto)) {
    estado.modo = 'config-if';
    estado.prompt = 'Router(config-if)#';
    return stream.write(`${estado.prompt} `);
  }
  if (/^(switchport|ip address|no shutdown|shutdown|no vlan)/.test(texto)) {
    return stream.write(`${estado.prompt} `);
  }
  if (/^ip route /.test(texto) || /^no ip route /.test(texto)) {
    return stream.write(`${estado.prompt} `);
  }
  if (/^show version/.test(texto)) {
    return stream.write(
      'Cisco IOS Software, C7200 Software (C7200-ADVENTERPRISEK9-M), Version 15.2(4)M7\r\n' +
        'Router uptime is 1 hour\r\n' +
        `${estado.prompt} `
    );
  }
  if (texto === 'show running-config') {
    const cuerpo = [
      'Building configuration...',
      '',
      'Current configuration : 1024 bytes',
      '!',
      'hostname Router',
      '!',
      ...COMANDOS.filter((comando) => !/^(show|enable|terminal|configure|end|exit)/.test(comando)),
      '!',
      'end',
    ].join('\r\n');
    return stream.write(`${cuerpo}\r\n${estado.prompt} `);
  }
  if (texto === 'write memory') {
    return stream.write('Building configuration...\r\n[OK]\r\n' + `${estado.prompt} `);
  }
  if (texto === 'show ip route') {
    return stream.write(`Gateway of last resort is 192.0.2.1\r\n${estado.prompt} `);
  }

  salida = "% Invalid input detected at '^' marker.\r\n";
  return stream.write(`${salida}${estado.prompt} `);
}

function iniciar(puerto = 2322, host = '127.0.0.1') {
  if (servidor) return Promise.resolve(servidor);
  COMANDOS.length = 0;
  servidor = new Server({ hostKeys: [generarClave()] }, (cliente) => {
    clientes.push(cliente);
    cliente.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'admin' && ctx.password === 'cisco') ctx.accept();
      else ctx.reject();
    });
    cliente.on('ready', () => {
      cliente.on('session', (accept) => {
        const sesion = accept();
        sesion.on('pty', (aceptar) => aceptar && aceptar());
        sesion.on('window-change', (aceptar) => aceptar && aceptar());
        sesion.on('shell', (aceptar) => {
          const flujo = aceptar();
          const estado = { modo: 'exec', prompt: 'Router>' };
          let buffer = '';
          flujo.write(`${estado.prompt} `);
          flujo.on('data', (datos) => {
            buffer += datos.toString('utf8');
            let corte = buffer.indexOf('\n');
            while (corte !== -1) {
              const linea = buffer.slice(0, corte).replace(/\r/g, '');
              buffer = buffer.slice(corte + 1);
              responder(linea, estado, flujo);
              corte = buffer.indexOf('\n');
            }
          });
        });
      });
    });
    cliente.on('close', () => {
      clientes = clientes.filter((c) => c !== cliente);
    });
  });

  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(puerto, host, () => resolve(servidor));
  });
}

function detener() {
  for (const cliente of clientes) {
    try { cliente.end(); } catch (error) { /* ya cerrado */ }
  }
  clientes = [];
  if (!servidor) return Promise.resolve();
  return new Promise((resolve) => servidor.close(() => {
    servidor = null;
    resolve();
  }));
}

module.exports = { iniciar, detener, COMANDOS };

if (require.main === module) {
  iniciar(Number(process.argv[2]) || 2322)
    .then(() => console.log('Cisco simulado escuchando en 127.0.0.1:2322 (admin/cisco).'))
    .catch((error) => { console.error(error.message); process.exit(1); });
}

