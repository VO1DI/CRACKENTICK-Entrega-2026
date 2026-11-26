require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Settings = require('./models/Settings');
const { ADMIN_PRINCIPAL } = require('./config/constants');

if (!process.argv.includes('--si')) {
  console.error('Esto vacía toda la base de datos. Ejecuta: node vaciar.js --si');
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const colecciones = await mongoose.connection.db.collections();
  for (const coleccion of colecciones) {
    await coleccion.drop().catch(() => {});
  }

  const admin = new User({
    username: ADMIN_PRINCIPAL.username,
    name: ADMIN_PRINCIPAL.name,
    email: ADMIN_PRINCIPAL.email,
    role: 'admin',
    permissions: [],
    active: true,
  });
  admin.establecerPassword('admin123');
  await admin.save();
  await Settings.getSingleton();
  await User.init();
  await Settings.init();

  console.log('Base vaciada. Único usuario: admin / admin123');
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.message);
  try { await mongoose.disconnect(); } catch (e) { /* sin conexión */ }
  process.exit(1);
});
