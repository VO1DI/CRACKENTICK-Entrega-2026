/**
 * Rota la clave AES de los secretos guardados (RouterOS, IA, Telegram, PPPoE).
 *
 *   node scripts/rotar-clave.js            # solo comprueba
 *   node scripts/rotar-clave.js --aplicar  # cambia la clave y guarda
 *
 * Guarda la clave nueva en .env. Detén la aplicación antes de aplicar.
 */
require('dotenv').config();
const fs = require('fs');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

const Settings = require('../models/Settings');
const Router = require('../models/Router');
const Sale = require('../models/Sale');
const Subscription = require('../models/Subscription');
const RouterBackup = require('../models/RouterBackup');
const { cifrar, descifrar, estaCifrado, cifrarBuffer, descifrarBuffer } = require('../services/cryptoService');

const aplicar = process.argv.includes('--aplicar');
const claveVieja = String(process.env.ENCRYPTION_KEY || '');
const claveNueva = aplicar
  ? crypto.randomBytes(32).toString('hex')
  : String(process.env.NEW_ENCRYPTION_KEY || claveVieja);
const ARCHIVO_RECUPERACION = '.env.rotacion';

/**
 * Antes de tocar la base guarda un .env de recuperación con las dos claves.
 * Si una escritura falla a mitad, copiarlo a .env permite leer todo.
 */
function escribirRecuperacion() {
  const env = fs.readFileSync('.env', 'utf8')
    .replace(/^ENCRYPTION_KEY_OLD=.*$/m, '')
    .replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${claveNueva}`);
  fs.writeFileSync(ARCHIVO_RECUPERACION, `${env.trimEnd()}\nENCRYPTION_KEY_OLD=${claveVieja}\n`, 'utf8');
}

function conClave(clave, fn) {
  const anterior = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = clave;
  try {
    return fn();
  } finally {
    process.env.ENCRYPTION_KEY = anterior;
  }
}

let cambios = 0;

function rotar(valor) {
  if (!valor || !estaCifrado(valor)) return valor;
  const plano = conClave(claveVieja, () => descifrar(valor));
  if (!plano) {
    const yaNuevo = conClave(claveNueva, () => descifrar(valor));
    if (yaNuevo) return valor;
    throw new Error('Un secreto no se pudo descifrar con la clave actual. No se cambió nada.');
  }
  const nuevo = conClave(claveNueva, () => cifrar(plano));
  if (nuevo !== valor) cambios += 1;
  return nuevo;
}

async function rotarSettings() {
  const doc = await Settings.findOne({ key: 'system' }).select(
    '+firewall.passwordEnc +ai.apiKeyEnc +ai.braveApiKeyEnc +notifications.telegram.botTokenEnc +notifications.telegram.bots.botTokenEnc'
  );
  if (!doc) return;
  doc.firewall.passwordEnc = rotar(doc.firewall.passwordEnc);
  doc.ai.apiKeyEnc = rotar(doc.ai.apiKeyEnc);
  doc.ai.braveApiKeyEnc = rotar(doc.ai.braveApiKeyEnc);
  doc.notifications.telegram.botTokenEnc = rotar(doc.notifications.telegram.botTokenEnc);
  for (const bot of doc.notifications.telegram.bots || []) {
    bot.botTokenEnc = rotar(bot.botTokenEnc);
  }
  if (aplicar) await doc.save();
}

async function rotarRouters() {
  const docs = await Router.find({}).select('+passwordEnc +enablePasswordEnc');
  for (const doc of docs) {
    doc.passwordEnc = rotar(doc.passwordEnc);
    doc.enablePasswordEnc = rotar(doc.enablePasswordEnc);
    if (aplicar) await doc.save();
  }
}

async function rotarSales() {
  const docs = await Sale.find({}).select('+service.pppoePasswordEnc');
  for (const doc of docs) {
    if (!doc.service) continue;
    doc.service.pppoePasswordEnc = rotar(doc.service.pppoePasswordEnc);
    if (aplicar) await doc.save();
  }
}

async function rotarSubscriptions() {
  const docs = await Subscription.find({}).select('+serviceConfig.pppoePasswordEnc');
  for (const doc of docs) {
    if (!doc.serviceConfig) continue;
    doc.serviceConfig.pppoePasswordEnc = rotar(doc.serviceConfig.pppoePasswordEnc);
    if (aplicar) await doc.save();
  }
}

/** Los respaldos binarios usan el mismo AES: sin rotarlos quedarían ilegibles. */
async function rotarRespaldosBinarios() {
  const docs = await RouterBackup.find({ format: 'backup' }).select('binary');
  for (const doc of docs) {
    if (!doc.binary || !doc.binary.length) continue;
    if (doc.binary.subarray(0, 4).toString() !== 'CTB1') continue;
    const plano = conClave(claveVieja, () => descifrarBuffer(doc.binary));
    doc.binary = conClave(claveNueva, () => cifrarBuffer(plano));
    cambios += 1;
    if (aplicar) await doc.save();
  }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    if (aplicar) escribirRecuperacion();
    await rotarSettings();
    await rotarRouters();
    await rotarSales();
    await rotarSubscriptions();
    await rotarRespaldosBinarios();

    if (!aplicar) {
      console.log(`Comprobación: ${cambios} secreto(s) se pueden rotar. Nada se guardó.`);
    } else {
      const env = fs.readFileSync('.env', 'utf8')
        .replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${claveNueva}`)
        .replace(/^ENCRYPTION_KEY_OLD=.*$/m, '');
      fs.writeFileSync('.env', `${env.trimEnd()}\n`, 'utf8');
      if (fs.existsSync(ARCHIVO_RECUPERACION)) fs.unlinkSync(ARCHIVO_RECUPERACION);
      console.log(`Rotación aplicada: ${cambios} secreto(s). La nueva clave quedó en .env.`);
    }
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  if (aplicar && fs.existsSync(ARCHIVO_RECUPERACION)) {
    console.error('La rotación quedó a medias. Copia .env.rotacion a .env y reinicia antes de usar la app.');
  }
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
