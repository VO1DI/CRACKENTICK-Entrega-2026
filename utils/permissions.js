/**
 * Niveles de permiso por nodo.
 * - 'editar' se guarda como la clave del nodo.
 * - 'ver' (solo lectura) se guarda como `clave:read`.
 * Un administrador siempre tiene 'editar'.
 */
const SUFIJO_LECTURA = ':read';
const NIVELES = ['none', 'ver', 'editar'];

function nivel(usuario, clave) {
  if (!usuario || !clave) return 'none';
  if (usuario.role === 'admin') return 'editar';
  const permisos = usuario.permissions || [];
  if (permisos.includes(clave)) return 'editar';
  if (permisos.includes(`${clave}${SUFIJO_LECTURA}`)) return 'ver';
  return 'none';
}

const puedeVer = (usuario, clave) => nivel(usuario, clave) !== 'none';
const puedeEditar = (usuario, clave) => nivel(usuario, clave) === 'editar';

/** Convierte los selects del formulario en el arreglo `permissions`. */
function permisosDesdeFormulario(body, grupos) {
  const permisos = [];
  for (const grupo of grupos) {
    for (const nodo of grupo.nodos) {
      const campo = `perm__${nodo.key.replace(/\./g, '__')}`;
      const valor = String(body[campo] || 'none');
      if (valor === 'editar') permisos.push(nodo.key);
      else if (valor === 'ver') permisos.push(`${nodo.key}${SUFIJO_LECTURA}`);
    }
  }
  return permisos;
}

module.exports = {
  SUFIJO_LECTURA,
  NIVELES,
  nivel,
  puedeVer,
  puedeEditar,
  permisosDesdeFormulario,
};
