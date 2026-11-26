/**
 * Pruebas de tipos de tarea: alta, edición, color, uso y borrado protegido.
 * Uso: node pruebas/probar-tipos-tarea.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const TaskType = require('../models/TaskType');
const WorkTask = require('../models/WorkTask');
const Client = require('../models/Client');
const User = require('../models/User');
const taskTypeService = require('../services/taskTypeService');
const taskTypeController = require('../controllers/taskTypeController');
const agendaController = require('../controllers/agendaController');

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
  return { usuario: { username: 'admin-tipos' }, flash: () => {}, session: {}, query: {}, body: {}, params: {}, ...extra };
}

async function correr(controlador, peticion) {
  const salida = respuesta();
  await controlador(peticion, salida.res, (error) => { throw error; });
  return salida.estado;
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_tipos');
  await mongoose.connection.db.dropDatabase();
  await taskTypeService.asegurarTipos();

  const admin = new User({ name: 'Admin Tipos', username: 'admin-tipos', role: 'admin', active: true });
  admin.establecerPassword('prueba123');
  await admin.save();

  const tipos = await taskTypeService.listar();
  assert.strictEqual(tipos.length, 6, 'deben existir los seis tipos base');
  assert.ok(tipos.some((tipo) => tipo.key === 'ip_publica'));

  const alta = await correr(taskTypeController.crear, req({
    body: { name: 'Visita técnica', color: '#ff0000', order: '15', description: 'Revisión en sitio', active: 'on' },
  }));
  assert.match(alta.redireccion, /\/agenda\/tipos$/);
  const nueva = await TaskType.findOne({ key: 'visita_tecnica' });
  assert.ok(nueva, 'debe crear la clave desde el nombre');
  assert.strictEqual(nueva.color, '#ff0000');

  const colorInvalido = await correr(taskTypeController.crear, req({
    body: { name: 'Color malo', color: 'rojo', active: 'on' },
  }));
  assert.strictEqual(colorInvalido.codigo, 422);
  assert.strictEqual(await TaskType.countDocuments({ name: 'Color malo' }), 0);

  // Editar no cambia la clave y conserva las tareas.
  const escritorio = new Date();
  escritorio.setHours(10, 0, 0, 0);
  const tarea = await WorkTask.create({
    title: 'Visita a cliente',
    assignedTo: admin._id,
    scheduledAt: escritorio,
    durationMinutes: 60,
    category: 'visita_tecnica',
  });
  await correr(taskTypeController.actualizar, req({
    params: { id: String(nueva._id) },
    body: { name: 'Visita en sitio', color: '#00ff00', order: '15', active: 'on' },
  }));
  const editada = await TaskType.findById(nueva._id);
  assert.strictEqual(editada.key, 'visita_tecnica', 'la clave no debe cambiar');
  assert.strictEqual(editada.name, 'Visita en sitio');
  assert.strictEqual(editada.color, '#00ff00');

  const agenda = await correr(agendaController.index, req({ usuario: admin, query: {} }));
  assert.ok(agenda.datos.tipos.some((tipo) => tipo.name === 'Visita en sitio'));
  const fila = agenda.datos.filas.find((persona) => String(persona._id) === String(admin._id));
  assert.ok(fila, 'la tarea debe aparecer en la agenda');
  assert.strictEqual(fila.tareas[0].color, '#00ff00', 'la agenda debe usar el color del tipo');

  // No se puede borrar un tipo en uso.
  const borradoEnUso = await correr(taskTypeController.eliminar, req({ params: { id: String(nueva._id) } }));
  assert.match(borradoEnUso.redireccion, /\/agenda\/tipos$/);
  assert.ok(await TaskType.findById(nueva._id), 'el tipo en uso debe conservarse');

  // Un tipo sin uso sí se puede borrar.
  const sinUso = await TaskType.create({ key: 'temporal', name: 'Temporal', color: '#123456', active: true });
  await correr(taskTypeController.eliminar, req({ params: { id: String(sinUso._id) } }));
  assert.strictEqual(await TaskType.findById(sinUso._id), null);

  // Desactivar lo saca de los formularios, pero no borra las tareas.
  await correr(taskTypeController.actualizar, req({
    params: { id: String(nueva._id) },
    body: { name: 'Visita en sitio', color: '#00ff00', order: '15' },
  }));
  assert.ok(!(await taskTypeService.listar()).some((tipo) => tipo.key === 'visita_tecnica'));
  assert.strictEqual((await WorkTask.findById(tarea._id)).category, 'visita_tecnica');

  const edicion = await correr(agendaController.formEditar, req({ usuario: admin, params: { id: String(tarea._id) } }));
  assert.ok(edicion.datos.categorias.visita_tecnica, 'la tarea debe seguir mostrando su tipo aunque esté inactivo');
  assert.match(edicion.datos.categorias.visita_tecnica, /inactivo/i);

  console.log('OK  Tipos de tarea: alta, color, edición, agenda, desactivar y borrado protegido.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
