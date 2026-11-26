/* Prueba de carga contra la API RouterOS: logins y comandos concurrentes.
   Uso: node pruebas/probar-api-concurrente.js [host] [puerto] [usuario] [clave] [n]
   Por defecto: 127.0.0.1 8728 crackentick-api [CHR_API_PASSWORD] 25
*/
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const routeros = require('../services/routeros');
const { cifrar } = require('../services/cryptoService');

const [host = '127.0.0.1', puerto = '8728', usuario = 'crackentick-api', clave = process.env.CHR_API_PASSWORD || '', total = '25'] = process.argv.slice(2);
const n = Math.max(1, Number(total) || 25);
const router = {
  host,
  port: Number(puerto),
  username: usuario,
  passwordEnc: cifrar(clave),
  transport: 'api',
  tls: false,
};

(async () => {
  console.log(`Probando ${host}:${puerto} con ${n} operaciones concurrentes...`);
  const t0 = Date.now();
  const logins = await Promise.allSettled(
    Array.from({ length: n }, async () => {
      const conexion = await routeros.conectar(router);
      routeros.cerrar(conexion);
    })
  );
  const t1 = Date.now();
  const comandos = await Promise.allSettled(
    Array.from({ length: n }, () => routeros.ejecutar(router, { path: '/system/resource/print' }))
  );
  const t2 = Date.now();
  const malosLogin = logins.filter((r) => r.status === 'rejected');
  const malosCmd = comandos.filter((r) => r.status === 'rejected');
  console.log(`logins:   ${n - malosLogin.length}/${n} ok en ${t1 - t0} ms`);
  console.log(`comandos: ${n - malosCmd.length}/${n} ok en ${t2 - t1} ms`);
  if (malosLogin.length) console.log('primer fallo login:', malosLogin[0].reason.message);
  if (malosCmd.length) console.log('primer fallo comando:', malosCmd[0].reason.message);
  process.exit(malosLogin.length || malosCmd.length ? 1 : 0);
})().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
