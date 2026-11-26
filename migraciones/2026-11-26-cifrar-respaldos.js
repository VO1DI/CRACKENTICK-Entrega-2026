/**
 * Migración: cifra los respaldos binarios que quedaron en texto plano.
 * Uso: node migraciones/2026-11-26-cifrar-respaldos.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const RouterBackup = require('../models/RouterBackup');
const { cifrarBuffer } = require('../services/cryptoService');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const respaldos = await RouterBackup.find({ format: 'backup' }).select('name binary');
  let cifrados = 0;
  for (const respaldo of respaldos) {
    if (!respaldo.binary || !respaldo.binary.length) continue;
    if (respaldo.binary.subarray(0, 4).toString() === 'CTB1') continue;
    respaldo.binary = cifrarBuffer(respaldo.binary);
    await respaldo.save();
    cifrados += 1;
  }
  console.log(`Respaldos binarios revisados: ${respaldos.length}. Cifrados ahora: ${cifrados}.`);
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
