/* Verifica que la laptop tiene todo para correr CRACKENTICK. No modifica nada. */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RAIZ = path.join(__dirname, '..');
const resultados = [];
const revisar = (nombre, fn) => {
  try {
    const detalle = fn();
    resultados.push({ ok: true, nombre, detalle: detalle || '' });
  } catch (error) {
    resultados.push({ ok: false, nombre, detalle: error.message });
  }
};

const exigir = (condicion, mensaje) => {
  if (!condicion) throw new Error(mensaje);
};

const version = Number(String(process.versions.node).split('.')[0]);
revisar('Node.js 18 o superior', () => {
  exigir(version >= 18, `tienes Node ${process.versions.node}`);
  return process.versions.node;
});

revisar('Archivo .env', () => {
  exigir(fs.existsSync(path.join(RAIZ, '.env')), 'no existe .env');
  return 'encontrado';
});

revisar('Dependencias instaladas', () => {
  for (const paquete of ['express', 'mongoose', 'ejs', 'node-routeros', 'ssh2']) {
    require.resolve(paquete, { paths: [RAIZ] });
  }
  return 'node_modules completo';
});

revisar('rclone (respaldos)', () => {
  const ruta = process.env.RCLONE_PATH;
  exigir(ruta, 'RCLONE_PATH vacio en .env');
  const absoluta = path.isAbsolute(ruta) ? ruta : path.join(RAIZ, ruta);
  exigir(fs.existsSync(absoluta), `no se encuentra ${ruta}`);
  return ruta;
});

(async () => {
  const mongoose = require('mongoose');
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const db = mongoose.connection.db;
    const colecciones = await db.listCollections({}, { nameOnly: true }).toArray();
    resultados.push({
      ok: true,
      nombre: 'Conexion a MongoDB',
      detalle: `${db.databaseName}: ${colecciones.length} coleccion(es)`,
    });
  } catch (error) {
    resultados.push({
      ok: false,
      nombre: 'Conexion a MongoDB',
      detalle: `${error.message}. Revisa que el servicio MongoDB este iniciado.`,
    });
  } finally {
    await mongoose.disconnect().catch(() => null);
  }

  let fallos = 0;
  console.log('');
  for (const fila of resultados) {
    console.log(`${fila.ok ? 'OK   ' : 'FALLA'} ${fila.nombre}${fila.detalle ? ` -> ${fila.detalle}` : ''}`);
    if (!fila.ok) fallos += 1;
  }
  console.log('');
  console.log(fallos ? `Entorno con ${fallos} problema(s).` : 'Entorno listo para probar.');
  process.exit(fallos ? 1 : 0);
})();
