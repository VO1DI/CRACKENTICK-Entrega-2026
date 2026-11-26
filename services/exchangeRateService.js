const Settings = require('../models/Settings');

const URL_BCV = 'https://ve.dolarapi.com/v1/dolares/oficial';
const VIGENCIA_MS = 30 * 60 * 1000;
const cache = { rate: 0, source: '', updatedAt: null, fetchedAt: 0 };

function normalizarTasa(valor) {
  const tasa = Number(valor);
  return Number.isFinite(tasa) && tasa > 0 ? Math.round(tasa * 10000) / 10000 : 0;
}

function redondearBs(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function invalidarCache() {
  cache.rate = 0;
  cache.source = '';
  cache.updatedAt = null;
  cache.fetchedAt = 0;
}

function convertirUsdABs(usd, rate) {
  const tasa = normalizarTasa(rate);
  if (!tasa) return null;
  return redondearBs(Number(usd) * tasa);
}

/** Última tasa conocida, sin salir a internet. */
async function tasaActual() {
  if (cache.rate) return { ok: true, rate: cache.rate, source: cache.source, updatedAt: cache.updatedAt, cached: true };
  const settings = await Settings.getSingleton();
  const rate = normalizarTasa(settings.billing.bcvRate);
  return {
    ok: rate > 0,
    rate,
    source: settings.billing.bcvSource || (rate ? 'guardada' : ''),
    updatedAt: settings.billing.bcvUpdatedAt || null,
    cached: true,
  };
}

/** Consulta dolarapi (oficial BCV) y cae a la última tasa guardada si no hay internet. */
async function obtenerTasa({ forzar = false } = {}) {
  if (!forzar && cache.rate && Date.now() - cache.fetchedAt < VIGENCIA_MS) {
    return { ok: true, rate: cache.rate, source: cache.source, updatedAt: cache.updatedAt, cached: true };
  }

  const controller = new AbortController();
  const temporizador = setTimeout(() => controller.abort(), 4500);
  try {
    const respuesta = await fetch(URL_BCV, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!respuesta.ok) throw new Error(`dolarapi respondió ${respuesta.status}`);
    const datos = await respuesta.json();
    const rate = normalizarTasa(datos.venta || datos.promedio || datos.compra);
    if (!rate) throw new Error('dolarapi no devolvió una tasa válida');

    cache.rate = rate;
    cache.source = 'dolarapi';
    cache.updatedAt = datos.fechaActualizacion ? new Date(datos.fechaActualizacion) : new Date();
    cache.fetchedAt = Date.now();

    Settings.updateOne(
      { key: 'system' },
      { $set: { 'billing.bcvRate': rate, 'billing.bcvUpdatedAt': cache.updatedAt, 'billing.bcvSource': 'dolarapi' } }
    ).catch(() => {});

    return { ok: true, rate, source: 'dolarapi', updatedAt: cache.updatedAt, cached: false };
  } catch (error) {
    const settings = await Settings.getSingleton();
    const rate = normalizarTasa(settings.billing.bcvRate);
    cache.rate = rate;
    cache.source = settings.billing.bcvSource || (rate ? 'guardada' : '');
    cache.updatedAt = settings.billing.bcvUpdatedAt || null;
    cache.fetchedAt = Date.now();
    return { ok: rate > 0, rate, source: cache.source || 'guardada', updatedAt: cache.updatedAt, cached: true, stale: true, error: error.message };
  } finally {
    clearTimeout(temporizador);
  }
}

module.exports = { tasaActual, obtenerTasa, convertirUsdABs, normalizarTasa, redondearBs, invalidarCache };
