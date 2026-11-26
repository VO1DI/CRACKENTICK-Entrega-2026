/* Exporta la base actual a pruebas/datos-base.json (formato EJSON). */
const path = require('node:path');
const fs = require('node:fs');
const { EJSON } = require('bson');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

(async () => {
  const destino = path.join(__dirname, 'datos-base.json');
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    const db = mongoose.connection.db;
    const lista = await db.listCollections({}, { nameOnly: true }).toArray();
    const datos = {};
    for (const { name } of lista.sort((a, b) => a.name.localeCompare(b.name))) {
      if (name.startsWith('system.')) continue;
      const filas = await db.collection(name).find({}).toArray();
      datos[name] = EJSON.serialize(filas);
      console.log(`${name}: ${filas.length}`);
    }
    fs.writeFileSync(destino, JSON.stringify(datos), 'utf8');
    const mb = (fs.statSync(destino).size / 1048576).toFixed(2);
    const total = Object.values(datos).reduce((suma, filas) => suma + filas.length, 0);
    console.log(`\nBase ${db.databaseName} exportada: ${total} documento(s), ${mb} MB -> ${destino}`);
  } catch (error) {
    console.error('No se pudo exportar:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => null);
  }
})();
