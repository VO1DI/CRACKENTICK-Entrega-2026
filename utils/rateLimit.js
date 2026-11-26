/**
 * Límite de intentos en memoria para login. Acota el número de claves para
 * que un atacante no pueda hacer crecer el mapa con usuarios aleatorios.
 * El intento se reserva al consultar `permitido`, así una ráfaga de
 * peticiones en paralelo no puede saltarse el máximo.
 */
function crearLimite({ max = 8, ventanaMs = 10 * 60 * 1000, maxClaves = 5000 } = {}) {
  const intentos = new Map();

  function registrar(llave) {
    const ahora = Date.now();
    const registro = intentos.get(llave) || { historial: [], sinConfirmar: 0 };
    registro.historial = registro.historial.filter((marca) => ahora - marca < ventanaMs);
    registro.historial.push(ahora);
    const yaExistia = intentos.has(llave);
    if (!yaExistia && intentos.size >= maxClaves) {
      let eliminado = false;
      for (const [clave, anterior] of intentos) {
        anterior.historial = anterior.historial.filter((marca) => ahora - marca < ventanaMs);
        if (!anterior.historial.length) {
          intentos.delete(clave);
          eliminado = true;
          break;
        }
      }
      /* Si todas las entradas están activas, no se expulsa a una víctima:
         no se registra la clave nueva, pero tampoco se borra su bloqueo. */
      if (!eliminado) return;
    }
    intentos.set(llave, registro);
  }

  function permitido(llave) {
    const ahora = Date.now();
    const registro = intentos.get(llave);
    if (registro) {
      registro.historial = registro.historial.filter((marca) => ahora - marca < ventanaMs);
      if (!registro.historial.length) {
        intentos.delete(llave);
      } else if (registro.historial.length >= max) {
        return false;
      }
    }
    registrar(llave);
    const actual = intentos.get(llave);
    if (actual) actual.sinConfirmar = (actual.sinConfirmar || 0) + 1;
    return true;
  }

  function anotar(llave, correcto) {
    if (correcto) {
      intentos.delete(llave);
      return;
    }
    const registro = intentos.get(llave);
    /* El intento ya quedó contado en `permitido`; solo se confirma el fallo. */
    if (registro && registro.sinConfirmar > 0) {
      registro.sinConfirmar -= 1;
      return;
    }
    registrar(llave);
  }

  return { permitido, anotar, tamano: () => intentos.size };
}

module.exports = { crearLimite };
