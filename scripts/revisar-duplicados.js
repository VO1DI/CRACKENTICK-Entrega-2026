/**
 * Revisa duplicados que impiden crear los índices únicos de MAC/serial.
 * No borra nada: informa para que se decida a mano.
 *
 * Uso: node scripts/revisar-duplicados.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Sale = require('../models/Sale');
const InventoryItem = require('../models/InventoryItem');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const [macServicios, macVentas, seriales] = await Promise.all([
    Subscription.aggregate([
      { $match: { 'serviceConfig.macAuthEnabled': true, 'serviceConfig.macAddress': { $gt: '' } } },
      { $group: { _id: '$serviceConfig.macAddress', n: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { n: { $gt: 1 } } },
    ]),
    Sale.aggregate([
      { $match: { status: 'waiting', 'service.macAuthEnabled': true, 'service.macAddress': { $gt: '' } } },
      { $group: { _id: '$service.macAddress', n: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { n: { $gt: 1 } } },
    ]),
    InventoryItem.aggregate([
      { $unwind: '$serials' },
      { $match: { 'serials.serial': { $gt: '' } } },
      { $group: { _id: '$serials.serial', n: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { n: { $gt: 1 } } },
    ]),
  ]);

  const total = macServicios.length + macVentas.length + seriales.length;
  console.log(`MAC duplicada en servicios: ${macServicios.length}`);
  macServicios.forEach((fila) => console.log(`  ${fila._id} x${fila.n} -> ${fila.ids.join(', ')}`));
  console.log(`MAC duplicada en ventas en espera: ${macVentas.length}`);
  macVentas.forEach((fila) => console.log(`  ${fila._id} x${fila.n} -> ${fila.ids.join(', ')}`));
  console.log(`Seriales duplicados: ${seriales.length}`);
  seriales.forEach((fila) => console.log(`  ${fila._id} x${fila.n} -> ${fila.ids.join(', ')}`));

  await mongoose.disconnect();
  if (total) {
    console.error('Hay duplicados: corrígelos antes de confiar en los índices únicos.');
    process.exit(1);
  }
  console.log('Sin duplicados de MAC ni seriales.');
  process.exit(0);
})().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
