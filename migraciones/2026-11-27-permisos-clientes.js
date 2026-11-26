/**
 * Migración: separa los permisos de la ficha del cliente.
 * Uso: node migraciones/2026-11-27-permisos-clientes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const usuarios = await User.find({ role: 'staff' }).select('username permissions').lean();
  let cambios = 0;

  for (const usuario of usuarios) {
    const permisos = new Set(usuario.permissions || []);
    const agregar = new Set();

    if (permisos.has('general.clientes')) agregar.add('clientes.datos');
    if (permisos.has('ventas.instalar')) {
      agregar.add('clientes.servicio');
      agregar.add('clientes.cortes');
    }
    if (['finanzas.facturas', 'finanzas.gestion', 'finanzas.facturacion'].some((clave) => permisos.has(clave))) {
      agregar.add('clientes.facturacion');
    }
    for (const clave of agregar) permisos.add(clave);

    const resultado = await User.updateOne(
      { _id: usuario._id },
      { $set: { permissions: [...permisos] } }
    );
    cambios += resultado.modifiedCount || 0;
  }

  console.log(`Usuarios revisados: ${usuarios.length}. Actualizados: ${cambios}.`);
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
