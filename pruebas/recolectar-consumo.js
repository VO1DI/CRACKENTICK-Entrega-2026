/* Lanza una recoleccion de consumo ahora, sin esperar los 15 minutos. */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
require('../models/Router');
require('../models/Client');
require('../models/Subscription');
const trafficDaily = require('../services/trafficDailyService');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    const resultado = await trafficDaily.recolectar();
    console.log('Recoleccion:', JSON.stringify(resultado));
  } catch (error) {
    console.error('Fallo:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => null);
  }
})();
