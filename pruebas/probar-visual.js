/**
 * Regresión visual: tres temas, Motion cargado y sin anime.js.
 * Uso: node pruebas/probar-visual.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (archivo) => fs.readFileSync(path.join(raiz, archivo), 'utf8');

const layout = leer('views/layout.ejs');
assert.ok(layout.includes('/vendor/motion.min.js'), 'el layout debe cargar Motion');
assert.ok(!layout.includes('/vendor/anime.min.js'), 'el layout no debe cargar anime.js');
assert.ok(layout.includes('/css/rework.css'), 'el layout debe cargar la capa visual');

const topbar = leer('views/partials/topbar.ejs');
for (const tema of ['oscuro', 'claro', 'claro-suave']) {
  assert.ok(topbar.includes(`data-tema-opcion="${tema}"`), `falta la opción de tema ${tema}`);
}

const app = leer('public/js/app.js');
assert.ok(app.includes("const TEMAS = ['oscuro', 'claro', 'claro-suave']"), 'faltan los tres temas en app.js');
assert.ok(app.includes('window.Motion'), 'app.js debe usar Motion');
assert.ok(!app.includes('window.anime'), 'app.js no debe usar anime.js');

const rework = leer('public/css/rework.css');
assert.ok(rework.includes("[data-tema='claro-suave']"), 'falta el tema claro lavanda');
assert.ok(rework.includes('@media (prefers-reduced-motion: reduce)'), 'falta respetar movimiento reducido');
assert.ok(fs.existsSync(path.join(raiz, 'public/vendor/motion.min.js')), 'falta el archivo local de Motion');
assert.ok(!fs.existsSync(path.join(raiz, 'public/vendor/anime.min.js')), 'anime.js ya no debe estar');

// Login del panel.
const authLayout = leer('views/layouts/auth.ejs');
const loginView = leer('views/auth/login.ejs');
assert.ok(authLayout.includes('/css/login.css'), 'el login debe cargar su hoja de estilos');
assert.ok(authLayout.includes('/js/login.js'), 'el login debe cargar sus animaciones');
assert.ok(authLayout.includes('/vendor/motion.min.js'), 'el login debe cargar Motion');
assert.ok(loginView.includes('login-card'), 'el login debe usar la tarjeta nueva');
assert.ok(loginView.includes('data-login="field"'), 'faltan los campos animados del login');
assert.ok(loginView.includes('loginCanvas'), 'el login debe conservar el fondo reactivo');
assert.ok(authLayout.includes('data-tema-opcion'), 'el login debe permitir elegir el tema directamente');

// Tema por usuario en el panel.
const userModel = leer('models/User.js');
assert.ok(userModel.includes("theme: { type: String, enum: ['oscuro', 'claro', 'claro-suave']"), 'falta el tema por usuario');
assert.ok(layout.includes('temaUsuario'), 'el layout debe usar el tema del usuario');
assert.ok(app.includes('/api/preferencias/tema'), 'falta guardar la preferencia de tema');

// Temas del portal de clientes.
const portalLayout = leer('views/layouts/portal.ejs');
const portalTemas = leer('public/css/portal-temas.css');
const portalJs = leer('public/js/portal.js');
const portalTema = leer('views/portal/_tema.ejs');
assert.ok(portalLayout.includes('/css/portal-temas.css'), 'el portal debe cargar sus temas');
assert.ok(portalLayout.includes('crackentick-portal-tema'), 'el portal debe recordar el tema');
assert.ok(portalTemas.includes("[data-tema='oscuro']"), 'falta el tema oscuro del portal');
assert.ok(portalTemas.includes("[data-tema='claro']"), 'falta el tema claro arena del portal');
assert.ok(portalJs.includes('crackentick-portal-tema'), 'portal.js debe guardar el tema');
assert.ok(leer('models/Client.js').includes('portalTheme'), 'el cliente debe recordar su tema');
assert.ok(leer('routes/portal.js').includes('/preferencia-tema'), 'falta la ruta para guardar el tema del cliente');
assert.ok(leer('controllers/portalController.js').includes('guardarTema'), 'falta guardarTema en el portal');
for (const tema of ['oscuro', 'claro', 'claro-suave']) {
  assert.ok(portalTema.includes(`data-p-tema-opcion="${tema}"`), `falta la opción ${tema} en el portal`);
}

console.log('OK  Visual: 3 temas del panel y del portal, Motion local y preferencia por usuario.');
