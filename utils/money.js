const { MONEDAS, MONEDA_POR_DEFECTO, LOCALE_POR_DEFECTO } = require('../config/constants');

/** Redondea a dos decimales evitando errores de coma flotante. */
function redondear(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  const signo = numero < 0 ? -1 : 1;
  const escalado = Number(`${Math.abs(numero)}e2`);
  if (!Number.isFinite(escalado)) return numero;
  return signo * Number(`${Math.round(escalado)}e-2`);
}

function monedaValida(code) {
  return MONEDAS.some((moneda) => moneda.code === String(code).toUpperCase());
}

function datosMoneda(code) {
  return (
    MONEDAS.find((moneda) => moneda.code === String(code).toUpperCase()) ||
    MONEDAS.find((moneda) => moneda.code === MONEDA_POR_DEFECTO)
  );
}

/**
 * Formatea un importe con la moneda y la configuración regional indicadas.
 * Si Intl falla, devuelve una representación simple y segura.
 */
function formatearDinero(valor, currency = MONEDA_POR_DEFECTO, locale = LOCALE_POR_DEFECTO) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';

  const code = monedaValida(currency) ? String(currency).toUpperCase() : MONEDA_POR_DEFECTO;
  const decimals = code === 'CLP' ? 0 : 2;

  try {
    const formateador = new Intl.NumberFormat(locale || LOCALE_POR_DEFECTO, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    const texto = formateador.format(Math.abs(numero));
    return numero < 0 ? `-${texto}` : texto;
  } catch (error) {
    return `${numero < 0 ? '-' : ''}${code} ${Math.abs(numero).toFixed(decimals)}`;
  }
}

/** Formatea una cifra sin símbolo de moneda. */
function formatearNumero(valor, locale = LOCALE_POR_DEFECTO, decimals = 2) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  try {
    return new Intl.NumberFormat(locale || LOCALE_POR_DEFECTO, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(numero);
  } catch (error) {
    return numero.toFixed(decimals);
  }
}

module.exports = { redondear, formatearDinero, formatearNumero, monedaValida, datosMoneda };
