function normalizarTexto(valor) {
  return String(valor || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function capitalizar(valor) {
  const texto = normalizarTexto(valor);
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : '';
}

function iniciales(nombre = '', apellido = '') {
  return `${String(nombre).charAt(0)}${String(apellido).charAt(0)}`.toUpperCase() || 'CL';
}

function escaparRegex(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncar(valor, maximo = 80) {
  const texto = String(valor || '');
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

/** Solo acepta una ruta interna; descarta `//sitio`, barras invertidas y saltos. */
function rutaInterna(valor, defecto = '/') {
  const texto = String(valor || '');
  if (!texto.startsWith('/') || texto.startsWith('//')) return defecto;
  if (texto.includes('\\') || /[\r\n]/.test(texto)) return defecto;
  return texto;
}

/** Enmascara cualquier valor que parezca una contraseña dentro de un objeto. */
function sanearSecretos(valor) {
  if (!valor || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(sanearSecretos);

  const resultado = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    if (/password|secret|token|clave|api[_-]?key/i.test(clave)) {
      resultado[clave] = contenido ? '••••••••' : contenido;
    } else if (contenido && typeof contenido === 'object') {
      resultado[clave] = sanearSecretos(contenido);
    } else {
      resultado[clave] = contenido;
    }
  }
  return resultado;
}

module.exports = { normalizarTexto, capitalizar, iniciales, escaparRegex, truncar, sanearSecretos, rutaInterna };
