const { descifrar } = require('./cryptoService');
const { crearError } = require('../utils/errors');

function baseUrl(settings) {
  const base = String(settings?.ai?.baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^ ]+$/i.test(base)) throw crearError(422, 'La URL base de la IA no es válida.');
  return base;
}

function apiKey(settings) {
  const clave = descifrar(settings?.ai?.apiKeyEnc || '');
  if (!clave) throw crearError(422, 'Falta la clave de la API de IA en Configuración.');
  return clave;
}

async function peticion(settings, ruta, opciones = {}) {
  const respuesta = await fetch(`${baseUrl(settings)}${ruta}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey(settings)}`,
      ...(opciones.headers || {}),
    },
    signal: AbortSignal.timeout(45000),
  });

  const texto = await respuesta.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch (error) {
    datos = null;
  }

  if (!respuesta.ok) {
    const detalle = datos?.error?.message || texto.slice(0, 200) || 'sin detalle';
    throw crearError(502, `El proveedor de IA respondió ${respuesta.status}: ${detalle}`);
  }
  return datos;
}

/** Lista los modelos disponibles en un proveedor compatible con OpenAI. */
async function listarModelos(settings) {
  const datos = await peticion(settings, '/models', { method: 'GET' });
  const modelos = (datos?.data || [])
    .map((modelo) => modelo.id)
    .filter(Boolean)
    .sort();
  return [...new Set(modelos)];
}

/** Una llamada de chat con soporte de herramientas. */
async function chat(settings, { messages, tools, temperature = 0.2 }) {
  const cuerpo = {
    model: settings?.ai?.model || 'gpt-4o-mini',
    messages,
    temperature,
  };
  if (tools && tools.length) {
    cuerpo.tools = tools;
    cuerpo.tool_choice = 'auto';
  }
  const datos = await peticion(settings, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
  const mensaje = datos?.choices?.[0]?.message;
  if (!mensaje) throw crearError(502, 'El proveedor de IA no devolvió una respuesta válida.');
  return mensaje;
}

/** Búsqueda simple en Internet con Brave Search API. */
async function buscarWeb(settings, consulta) {
  const clave = descifrar(settings?.ai?.braveApiKeyEnc || '');
  if (!clave) throw crearError(422, 'La búsqueda web no está configurada (falta la clave de Brave).');

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', String(consulta || '').slice(0, 200));
  url.searchParams.set('count', '5');
  const respuesta = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': clave },
    signal: AbortSignal.timeout(20000),
  });
  if (!respuesta.ok) throw crearError(502, `Brave respondió ${respuesta.status}.`);
  const datos = await respuesta.json();
  return (datos?.web?.results || []).slice(0, 5).map((resultado) => ({
    titulo: resultado.title,
    url: resultado.url,
    descripcion: String(resultado.description || '').replace(/<[^>]+>/g, '').slice(0, 240),
  }));
}

module.exports = { listarModelos, chat, buscarWeb };
