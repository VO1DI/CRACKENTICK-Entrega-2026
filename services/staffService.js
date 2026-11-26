const User = require('../models/User');
const { escaparRegex } = require('../utils/strings');

/** Devuelve el usuario cuyo nombre o login coincide, para guardar la referencia estable. */
async function usuarioPorNombre(nombre) {
  const texto = String(nombre || '').trim();
  if (!texto) return null;
  const patron = new RegExp(`^${escaparRegex(texto)}$`, 'i');
  const usuario = await User.findOne({
    $or: [{ name: patron }, { username: texto.toLowerCase() }],
  })
    .select('_id')
    .lean();
  return usuario ? usuario._id : null;
}

module.exports = { usuarioPorNombre };
