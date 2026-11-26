/* Restaura pruebas/datos-base.json en la base. Borra las colecciones que carga.
   Uso: node pruebas/importar-base.js --si
   Destino alterno (para pruebas): MONGO_URI_DESTINO=mongodb://127.0.0.1:27017/otra_base
*/
const path = require('node:path');
const fs = require('node:fs');
const { EJSON } = require('bson');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const archive = path.join(__dirname, 'datos-base.json');

(async () => {
  if (!process.argv.includes('--si')) {
    console.log('Esto BORRA y reemplaza las colecciones de la base de datos.');
    console.log('Si estas seguro, ejecuta: node pruebas/importar-base.js --si');
    process.exit(1);
  }
  if (!fs.existsSync(archive)) {
    console.error(`Falta ${archive}. Copia el archivo del equipo original.`);
    process.exit(1);
  }

  const uri = process.env.MONGO_URI_DESTINO || process.env.MONGODB_URI;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    const db = mongoose.connection.db;
    const datos = EJSON.deserialize(JSON.parse(fs.readFileSync(archive, 'utf8')));
    console.log(`Restaurando en ${db.databaseName}...`);
    let total = 0;
    for (const [nombre, filas] of Object.entries(datos)) {
      const coleccion = db.collection(nombre);
      await coleccion.deleteMany({});
      for (let i = 0; i < filas.length; i += 300) {
        await coleccion.insertMany(filas.slice(i, i + 300), { ordered: false });
      }
      total += filas.length;
      console.log(`${nombre}: ${filas.length}`);
    }
    console.log(`\nListo: ${total} documento(s) restaurados en ${db.databaseName}.`);
    console.log('Inicia la aplicacion para que MongoDB cree los indices.');
  } catch (error) {
    console.error('No se pudo restaurar:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => null);
  }
})();
