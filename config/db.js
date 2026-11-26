const mongoose = require('mongoose');

/**
 * Abre la conexión con MongoDB usando la URI definida en .env
 * y registra eventos útiles para diagnosticar problemas.
 */
async function conectarDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/crackentick';

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    const { host, name } = mongoose.connection;
    console.log(`✅ MongoDB conectado en ${host}/${name}`);
  });

  mongoose.connection.on('error', (error) => {
    console.error('❌ Error de MongoDB:', error.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  Se perdió la conexión con MongoDB.');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
  });

  return mongoose.connection;
}

async function desconectarDB() {
  await mongoose.connection.close();
  console.log('🔌 Conexión con MongoDB cerrada.');
}

module.exports = { conectarDB, desconectarDB };
