/* Fuerza el vencimiento de un voucher vendido y ejecuta la limpieza.
   Uso: node pruebas/forzar-vencido.js [CODIGO]
   Sin codigo usa el voucher vendido mas reciente.
*/
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
require('../models/Router');
require('../models/HotspotPlan');
require('../models/HotspotBatch');
const HotspotVoucher = require('../models/HotspotVoucher');
const hotspot = require('../services/hotspotService');

(async () => {
  const codigo = (process.argv[2] || '').trim().toUpperCase();
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    const filtro = { status: 'sold', durationMinutes: { $gt: 0 } };
    if (codigo) filtro.code = codigo;
    const voucher = await HotspotVoucher.findOne(filtro).sort({ soldAt: -1 });
    if (!voucher) {
      console.log('No hay vouchers vendidos con duracion. Vende uno primero.');
      process.exitCode = 1;
      return;
    }
    voucher.startedAt = new Date(Date.now() - (voucher.durationMinutes + 1) * 60000);
    await voucher.save();
    console.log(`Voucher ${voucher.code}: inicio forzado hace ${voucher.durationMinutes + 1} min.`);
    const resultado = await hotspot.limpiarVencidos();
    const despues = await HotspotVoucher.findById(voucher._id).lean();
    console.log('Limpieza:', JSON.stringify(resultado), '| estado:', despues.status);
  } catch (error) {
    console.error('Fallo:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => null);
  }
})();
