/**
 * Migración: agrega `ventas.instalar` a los usuarios técnicos existentes.
 * Uso: node migraciones/2026-11-26-permiso-instalar.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const empleados = await Employee.find({ active: true }).select('userId name position area').lean();
  const tecnicos = new Set();
  for (const empleado of empleados) {
    if (!empleado.userId) continue;
    if (empleado.area === 'tecnicos' || /t[eé]cnic|instalador/i.test(empleado.position || '')) {
      tecnicos.add(String(empleado.userId));
    }
  }
  const porNombre = await User.find({ username: 'tecnico' }).select('_id').lean();
  porNombre.forEach((usuario) => tecnicos.add(String(usuario._id)));

  let cambios = 0;
  for (const id of tecnicos) {
    const resultado = await User.updateOne(
      { _id: id, role: 'staff', permissions: { $ne: 'ventas.instalar' } },
      { $addToSet: { permissions: 'ventas.instalar' } }
    );
    cambios += resultado.modifiedCount || 0;
  }

  console.log(`Técnicos detectados: ${tecnicos.size}. Usuarios actualizados: ${cambios}.`);
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
