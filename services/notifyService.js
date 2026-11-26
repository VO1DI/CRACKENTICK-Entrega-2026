const Settings = require('../models/Settings');
const telegramService = require('./telegramService');
const { formatearFechaHora } = require('../utils/dates');

const ICONOS = {
  wan_down: '🔴',
  wan_up: '🟢',
  stock_low: '🟡',
  client_down: '🔴',
  wan_latency: '🟡',
};

const TITULOS = {
  wan_down: 'WAN caída',
  wan_up: 'WAN restablecida',
  stock_low: 'Stock bajo',
  client_down: 'Cliente sin conexión',
  wan_latency: 'Latencia WAN',
  router_down: 'Router caído',
  router_up: 'Router restablecido',
};

const CATEGORIA_POR_TIPO = {
  wan_down: 'red',
  wan_up: 'red',
  wan_latency: 'red',
  router_down: 'red',
  router_up: 'red',
  client_down: 'servicios',
  stock_low: 'almacen',
};

const TODAS = ['red', 'servicios', 'almacen'];

function textoAlerta(alerta) {
  const lineas = [
    `${ICONOS[alerta.type] || '🔔'} CRACKENTICK · ${TITULOS[alerta.type] || 'Aviso'}`,
    alerta.message,
  ];
  if (alerta.routerName) lineas.push(`Router: ${alerta.routerName}${alerta.wan ? ` · ${alerta.wan}` : ''}`);
  if (alerta.value) lineas.push(`Valor: ${alerta.value}`);
  lineas.push(`Hora: ${formatearFechaHora(alerta.startedAt)}`);
  return lineas.join('\n');
}

/** Bots configurados; si aún no hay lista usa la configuración antigua. */
function destinosPara(settings) {
  const config = settings?.notifications?.telegram || {};
  const bots = (config.bots || []).filter((bot) => bot.botTokenEnc && bot.chatId);
  if (bots.length) return bots;
  if (config.botTokenEnc && config.chatId) {
    return [{ botTokenEnc: config.botTokenEnc, chatId: config.chatId, categories: TODAS }];
  }
  return [];
}

/** Envía una alerta a los bots suscritos a su categoría. Nunca lanza. */
async function notificarAlerta(alerta) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select(
      '+notifications.telegram.botTokenEnc +notifications.telegram.bots.botTokenEnc'
    );
    if (!settings?.notifications?.telegram?.enabled) return false;

    const categoria = CATEGORIA_POR_TIPO[alerta.type] || 'red';
    const destinos = destinosPara(settings).filter((bot) => (bot.categories || []).includes(categoria));
    if (!destinos.length) return false;

    const texto = textoAlerta(alerta);
    const resultados = await Promise.allSettled(destinos.map((bot) => telegramService.enviar(bot, texto)));
    resultados.forEach((resultado, indice) => {
      if (resultado.status === 'rejected') {
        console.error(`⚠️  No se pudo enviar la alerta a Telegram (${destinos[indice].name || indice + 1}):`, resultado.reason.message);
      }
    });
    return resultados.some((resultado) => resultado.status === 'fulfilled');
  } catch (error) {
    console.error('⚠️  No se pudo enviar la alerta a Telegram:', error.message);
    return false;
  }
}

module.exports = { notificarAlerta, textoAlerta, destinosPara, CATEGORIA_POR_TIPO };
