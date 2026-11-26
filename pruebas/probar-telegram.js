/**
 * Autocomprobación de las notificaciones de Telegram:
 * enrutado por categoría, varios bots y compatibilidad con el bot único.
 *
 * Uso: node pruebas/probar-telegram.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/crackentick_test_telegram';
const Settings = require('../models/Settings');
const { cifrar, descifrar } = require('../services/cryptoService');
const telegramService = require('../services/telegramService');
const notifyService = require('../services/notifyService');
const { normalizarBots, botsParaVista } = require('../controllers/settingsController');

const TOKEN_A = '111111:AAA_aaa';
const TOKEN_B = '222222:BBB_bbb';

function alerta(type) {
  return { type, message: `Aviso ${type}`, routerName: 'CHR', wan: 'wan1', value: '1', startedAt: new Date() };
}

async function main() {
  await mongoose.connect(URI);
  await Settings.deleteMany({});

  /* 1. Enrutado por categoría con dos bots. */
  await Settings.create({
    key: 'system',
    notifications: {
      telegram: {
        enabled: true,
        bots: [
          { name: 'Red', botTokenEnc: cifrar(TOKEN_A), chatId: '100', categories: ['red'] },
          { name: 'Operación', botTokenEnc: cifrar(TOKEN_B), chatId: '200', categories: ['servicios', 'almacen'] },
        ],
      },
    },
  });

  const enviados = [];
  const original = telegramService.enviar;
  telegramService.enviar = async (bot, texto) => {
    enviados.push({ chatId: bot.chatId, texto });
    return { message_id: enviados.length };
  };

  const casos = [
    ['wan_down', ['100']],
    ['wan_up', ['100']],
    ['wan_latency', ['100']],
    ['client_down', ['200']],
    ['stock_low', ['200']],
  ];
  for (const [tipo, esperados] of casos) {
    enviados.length = 0;
    const ok = await notifyService.notificarAlerta(alerta(tipo));
    assert.strictEqual(ok, true, `${tipo} debió enviarse`);
    assert.deepStrictEqual(enviados.map((e) => e.chatId), esperados, `${tipo} fue a los bots equivocados`);
    assert.ok(enviados[0].texto.includes('CRACKENTICK'), 'el mensaje perdió el encabezado');
  }

  /* 2. Compatibilidad: base con un solo bot antiguo. */
  const unico = await Settings.findOne({ key: 'system' });
  unico.notifications.telegram.bots = [];
  unico.notifications.telegram.botTokenEnc = cifrar(TOKEN_A);
  unico.notifications.telegram.chatId = '-100999';
  await unico.save();
  enviados.length = 0;
  await notifyService.notificarAlerta(alerta('stock_low'));
  assert.deepStrictEqual(enviados.map((e) => e.chatId), ['-100999'], 'el bot antiguo no recibió la alerta');

  /* 3. El formulario muestra el bot antiguo como fila editable. */
  const conLegacy = await Settings.findOne({ key: 'system' }).select('+notifications.telegram.botTokenEnc +notifications.telegram.bots.botTokenEnc');
  const filasLegacy = botsParaVista(conLegacy);
  assert.strictEqual(filasLegacy.length, 1);
  assert.strictEqual(filasLegacy[0].legacy, true);
  assert.strictEqual(filasLegacy[0].tokenConfigured, true);

  /* 4. Normalización: conserva token, descarta filas vacías y valida. */
  const normalizados = normalizarBots(
    [
      { name: 'Principal', chatId: '-100999', cat_red: 'on', legacy: 'on' },
      { name: '', token: '', chatId: '', cat_red: '' },
      { name: 'Almacén', token: TOKEN_B, chatId: '200', cat_almacen: 'on', cat_servicios: 'on' },
    ],
    [],
    cifrar(TOKEN_A)
  );
  assert.strictEqual(normalizados.length, 2);
  assert.strictEqual(descifrar(normalizados[0].botTokenEnc), TOKEN_A);
  assert.deepStrictEqual(normalizados[1].categories, ['servicios', 'almacen']);

  assert.throws(() => normalizarBots([{ token: 'mal-token', chatId: '1', cat_red: 'on' }]), /formato correcto/);
  assert.throws(() => normalizarBots([{ token: TOKEN_A, chatId: '1' }]), /al menos una categoría/);
  assert.throws(() => normalizarBots([{ token: TOKEN_A, chatId: 'abc', cat_red: 'on' }]), /chat ID/);

  /* 5. Persistencia: tokens ocultos por defecto y visibles al pedirlos. */
  const guardado = await Settings.findOne({ key: 'system' }).select('+notifications.telegram.bots.botTokenEnc');
  guardado.notifications.telegram.bots = normalizados;
  guardado.notifications.telegram.botTokenEnc = '';
  guardado.notifications.telegram.chatId = '';
  await guardado.save();

  const recargado = await Settings.findOne({ key: 'system' }).select('+notifications.telegram.bots.botTokenEnc');
  assert.strictEqual(recargado.notifications.telegram.bots.length, 2);
  assert.strictEqual(descifrar(recargado.notifications.telegram.bots[0].botTokenEnc), TOKEN_A);

  const sinSelect = await Settings.findOne({ key: 'system' });
  assert.ok(!sinSelect.notifications.telegram.bots[0].botTokenEnc, 'el token no debe salir sin pedirlo');

  telegramService.enviar = original;
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log('OK  Telegram: 5 casos de enrutado, bot único, normalización y persistencia.');
  process.exit(0);
}

main().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
