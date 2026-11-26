const User = require('../models/User');
const { registrar } = require('../services/auditService');
const { rutaInicial } = require('../middlewares/auth');
const { rutaInterna } = require('../utils/strings');
const { crearLimite } = require('../utils/rateLimit');
const { hashPassword, verifyPassword } = require('../utils/password');

const limite = crearLimite({ max: 8 });
const limiteIp = crearLimite({ max: 100 });
const HASH_FICTICIO = hashPassword('comparacion-interna');

const MENSAJE_CREDENCIALES = 'Usuario o contraseña incorrectos.';

/** GET /login — pantalla de acceso. */
function mostrar(req, res) {
  if (req.usuario) return res.redirect(rutaInicial(req.usuario));

  const errores = req.flash('error');
  return res.render('auth/login', {
    layout: 'layouts/auth',
    titulo: 'Iniciar sesión',
    error: errores.length ? errores[0] : null,
    usuario: '',
  });
}

/** POST /login — valida credenciales reales. */
async function entrar(req, res, next) {
  const username = String(req.body.usuario || req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const recordarme = req.body.recordarme === 'on' || req.body.recordarme === 'true' || req.body.recordarme === '1';

  const responder = (mensaje, status = 401) =>
    res.status(status).render('auth/login', {
      layout: 'layouts/auth',
      titulo: 'Iniciar sesión',
      error: mensaje,
      usuario: username,
    });

  try {
    if (!username || !password) {
      return responder('Indica tu usuario y contraseña.');
    }

    const ip = req.ip || 'local';
    const llave = `${ip}:${username}`;
    if (!limite.permitido(llave) || !limiteIp.permitido(ip)) {
      return responder('Demasiados intentos fallidos. Espera unos minutos.', 429);
    }

    const usuario = await User.findOne({ username }).select('+passwordHash');
    if (!usuario) verifyPassword(password, HASH_FICTICIO);
    if (!usuario || !usuario.verificarPassword(password) || !usuario.active) {
      limite.anotar(llave, false);
      limiteIp.anotar(ip, false);
      return responder(MENSAJE_CREDENCIALES);
    }
    limite.anotar(llave, true);
    limiteIp.anotar(ip, true);

    const destino = req.session && req.session.returnTo ? req.session.returnTo : null;

    req.session.regenerate((error) => {
      if (error) return next(error);

      req.session.usuarioId = String(usuario._id);
      req.session.version = Number(usuario.sessionVersion) || 0;
      if (recordarme) req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 7;

      usuario.lastLoginAt = new Date();
      usuario
        .save()
        .then(() =>
          registrar({
            module: 'auth',
            entity: 'User',
            entityId: usuario._id,
            action: 'login',
            description: `Inicio de sesión de ${usuario.name} (${usuario.username}).`,
            status: 'success',
            actor: usuario.username,
          })
        )
        .catch(() => {});

      req.flash('exito', `Bienvenido, ${usuario.name}.`);
      const ruta = destino ? rutaInterna(destino, rutaInicial(usuario)) : rutaInicial(usuario);
      return res.redirect(ruta);
    });
  } catch (error) {
    return next(error);
  }
}

/** POST /salir — cierra la sesión. */
function salir(req, res) {
  const nombre = req.usuario ? req.usuario.name : null;
  if (!req.session) return res.redirect('/login');

  req.session.destroy(() => {
    res.clearCookie('crackentick.sid');
    if (nombre) {
      // No se puede usar flash después de destruir la sesión; se registra en auditoría.
      registrar({
        module: 'auth',
        entity: 'User',
        action: 'logout',
        description: `Cierre de sesión de ${nombre}.`,
        status: 'success',
        actor: nombre,
      }).catch(() => {});
    }
    res.redirect('/login');
  });
}

module.exports = { mostrar, entrar, salir };
