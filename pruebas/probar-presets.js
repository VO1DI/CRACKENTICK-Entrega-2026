/**
 * Pruebas de presets de permisos: crear, editar y borrar sin tocar usuarios.
 * Uso: node pruebas/probar-presets.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const User = require('../models/User');
const PermissionPreset = require('../models/PermissionPreset');
const presetController = require('../controllers/presetController');

function respuesta() {
  const estado = { redireccion: '', datos: null, codigo: 200 };
  const res = {
    redirect: (url) => { estado.redireccion = url; },
    render: (vista, datos) => { estado.datos = datos; },
    status: (codigo) => { estado.codigo = codigo; return res; },
  };
  return { res, estado };
}

function req(extra = {}) {
  return { usuario: { username: 'admin-presets', role: 'admin' }, flash: () => {}, session: {}, query: {}, body: {}, params: {}, ...extra };
}

async function correr(controlador, peticion) {
  const salida = respuesta();
  await controlador(peticion, salida.res, (error) => { throw error; });
  return salida.estado;
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_presets');
  await mongoose.connection.db.dropDatabase();

  const usuario = new User({
    name: 'Técnico Existente',
    username: 'tecnico-existente',
    role: 'staff',
    permissions: ['general.clientes'],
    active: true,
  });
  usuario.establecerPassword('prueba123');
  await usuario.save();

  const alta = await correr(presetController.crear, req({
    body: {
      name: 'Técnico de red',
      description: 'Instalaciones y monitoreo',
      perm__general__clientes: 'editar',
      perm__red__monitoreo: 'ver',
      perm__agenda__gestion: 'editar',
      active: 'on',
    },
  }));
  assert.match(alta.redireccion, /\/admin\/usuarios\/presets$/);
  const preset = await PermissionPreset.findOne({ name: 'Técnico de red' });
  assert.ok(preset);
  assert.ok(preset.permissions.includes('general.clientes'));
  assert.ok(preset.permissions.includes('red.monitoreo:read'));
  assert.ok(preset.permissions.includes('agenda.gestion'));

  // Editar el preset no debe tocar los permisos del usuario.
  const antes = [...(await User.findById(usuario._id)).permissions];
  await correr(presetController.actualizar, req({
    params: { id: String(preset._id) },
    body: {
      name: 'Técnico de red',
      description: 'Cambiado',
      perm__finanzas__facturas: 'editar',
      perm__red__routers: 'editar',
      active: 'on',
    },
  }));
  const editado = await PermissionPreset.findById(preset._id);
  assert.ok(editado.permissions.includes('finanzas.facturas'));
  assert.ok(!editado.permissions.includes('agenda.gestion'));
  const despues = (await User.findById(usuario._id)).permissions;
  assert.deepStrictEqual(despues, antes, 'editar el preset no debe cambiar usuarios');
  assert.strictEqual(editado.description, 'Cambiado');

  // Borrar el preset tampoco toca al usuario.
  await correr(presetController.eliminar, req({ params: { id: String(preset._id) } }));
  assert.strictEqual(await PermissionPreset.findById(preset._id), null);
  assert.deepStrictEqual((await User.findById(usuario._id)).permissions, antes, 'borrar el preset no debe cambiar usuarios');

  // Validaciones.
  const sinPermisos = await correr(presetController.crear, req({ body: { name: 'Vacío', active: 'on' } }));
  assert.strictEqual(sinPermisos.codigo, 422);
  assert.ok(sinPermisos.datos.errores.some((m) => /al menos un permiso/.test(m)));

  const sinNombre = await correr(presetController.crear, req({ body: { name: '', perm__general__clientes: 'ver', active: 'on' } }));
  assert.strictEqual(sinNombre.codigo, 422);

  console.log('OK  Presets: alta, edición y borrado no modifican los permisos de usuarios.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
