const { descifrar } = require('./cryptoService');
const { crearError } = require('../utils/errors');

/** Envía un mensaje de texto al bot y chat indicados. */
async function enviar(destino, texto) {
  const token = descifrar(destino?.botTokenEnc || '');
  const chatId = String(destino?.chatId || '').trim();
  if (!token) throw crearError(422, 'Falta el token del bot de Telegram.');
  if (!chatId) throw crearError(422, 'Falta el chat ID de Telegram.');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw crearError(422, 'El token del bot de Telegram no es válido.');

  const respuesta = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(texto || '').slice(0, 3900),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !datos?.ok) {
    throw crearError(502, datos?.description || `Telegram respondió ${respuesta.status}.`);
  }
  return datos.result;
}

module.exports = { enviar };
