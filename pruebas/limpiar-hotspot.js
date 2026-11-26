/* Elimina ahora los usuarios hotspot vencidos, sin esperar los 5 minutos. */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
require('../models/Router');
require('../models/HotspotPlan');
require('../models/HotspotBatch');
const hotspot = require('../services/hotspotService');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    const resultado = await hotspot.limpiarVencidos();
    console.log('Limpieza:', JSON.stringify(resultado));
  } catch (error) {
    console.error('Fallo:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => null);
  }
})();
