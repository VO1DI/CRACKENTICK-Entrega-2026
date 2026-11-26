/**
 * Pruebas de agenda/tareas: alta, categoría, carriles y estados.
 * Uso: node pruebas/probar-agenda.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const User = require('../models/User');
const Client = require('../models/Client');
const WorkTask = require('../models/WorkTask');
const agendaController = require('../controllers/agendaController');
const taskTypeService = require('../services/taskTypeService');

function respuesta() {
  const estado = { redireccion: '', datos: null, codigo: 200 };
  const res = {
    redirect: (url) => { estado.redireccion = url; },
    render: (vista, datos) => { estado.datos = datos; },
    status: (codigo) => { estado.codigo = codigo; return res; },
  };
  return { res, estado };
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_agenda');
  await mongoose.connection.db.dropDatabase();
  await taskTypeService.asegurarTipos();

  const admin = new User({ name: 'Admin', username: 'admin-agenda', role: 'admin', active: true });
  admin.establecerPassword('prueba123');
  await admin.save();
  const tecnico = new User({ name: 'Técnico Uno', username: 'tecnico-agenda', role: 'staff', active: true });
  tecnico.establecerPassword('prueba123');
  await tecnico.save();

  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const baseReq = { usuario: admin, flash: () => {} };

  const alta = respuesta();
  await agendaController.crear(
    {
      ...baseReq,
      body: {
        title: 'Instalar cliente',
        assignedTo: String(tecnico._id),
        scheduledAt: `${fecha}T10:00`,
        durationMinutes: '60',
        category: 'soporte',
        priority: 'high',
      },
    },
    alta.res,
    (error) => { throw error; }
  );
  const primera = await WorkTask.findOne({ title: 'Instalar cliente' });
  assert.ok(primera, 'la tarea debe crearse');
  assert.strictEqual(primera.category, 'soporte', 'la categoría debe guardarse');
  assert.strictEqual(primera.priority, 'high');
  assert.strictEqual(primera.scheduledAt.getHours(), 10, 'la hora debe conservarse');

  const segunda = await WorkTask.create({
    title: 'Soporte en sitio',
    assignedTo: tecnico._id,
    scheduledAt: new Date(`${fecha}T10:30:00`),
    durationMinutes: 60,
    category: 'soporte',
    priority: 'medium',
  });

  const agenda = respuesta();
  await agendaController.index(
    { usuario: admin, query: { fecha } },
    agenda.res,
    (error) => { throw error; }
  );
  const fila = agenda.estado.datos.filas.find((f) => String(f._id) === String(tecnico._id));
  assert.ok(fila, 'el técnico debe aparecer en la agenda');
  assert.strictEqual(fila.tareas.length, 2, 'deben verse las dos tareas');
  assert.deepStrictEqual(fila.tareas.map((t) => t.carril).sort(), [0, 1], 'deben ocupar carriles distintos');

  const inicio = respuesta();
  await agendaController.cambiarEstado(
    { ...baseReq, params: { id: String(primera._id) }, body: { accion: 'iniciar' } },
    inicio.res,
    (error) => { throw error; }
  );
  let actual = await WorkTask.findById(primera._id);
  assert.strictEqual(actual.status, 'in_progress');
  assert.ok(actual.startedAt);

  const fin = respuesta();
  await agendaController.cambiarEstado(
    { ...baseReq, params: { id: String(primera._id) }, body: { accion: 'finalizar' } },
    fin.res,
    (error) => { throw error; }
  );
  actual = await WorkTask.findById(primera._id);
  assert.strictEqual(actual.status, 'done');
  assert.ok(actual.finishedAt);

  const staff = respuesta();
  await agendaController.index(
    { usuario: tecnico, query: { fecha } },
    staff.res,
    (error) => { throw error; }
  );
  const visibleStaff = staff.estado.datos.filas.find((f) => String(f._id) === String(tecnico._id));
  assert.strictEqual(visibleStaff.tareas.length, 2, 'el técnico ve sus tareas');

  // La cuadrícula debe cubrir de 8:00 a 24:00.
  assert.strictEqual(agenda.estado.datos.horas[0], 8, 'la agenda empieza a las 8');
  assert.strictEqual(agenda.estado.datos.horas[agenda.estado.datos.horas.length - 1], 23, 'la agenda llega hasta las 23');
  assert.strictEqual(agenda.estado.datos.etiquetasHora.length, 16, 'deben mostrarse 16 horas');

  const crearCon = async (body) => {
    const salida = respuesta();
    await agendaController.crear(
      { ...baseReq, body: { title: 'Prueba duración', assignedTo: String(tecnico._id), ...body } },
      salida.res,
      (error) => { throw error; }
    );
    return salida.estado;
  };

  // Duración en horas.
  const porHoras = await crearCon({ scheduledAt: `${fecha}T20:00`, durationMode: 'horas', durationHours: '1.5' });
  assert.ok(porHoras.redireccion, 'la tarea en horas debe crearse');
  const tareaHoras = await WorkTask.findOne({ title: 'Prueba duración', scheduledAt: new Date(`${fecha}T20:00:00`) });
  assert.ok(tareaHoras, 'debe existir la tarea de 1.5 horas');
  assert.strictEqual(tareaHoras.durationMinutes, 90);

  // Duración de hora a hora; la hora "desde" fija el inicio.
  const porRango = await crearCon({ scheduledAt: `${fecha}T07:00`, durationMode: 'rango', durationFrom: '22:00', durationTo: '23:30' });
  assert.ok(porRango.redireccion, 'la tarea por rango debe crearse');
  const tareaRango = await WorkTask.findOne({ title: 'Prueba duración', durationMinutes: 90, scheduledAt: new Date(`${fecha}T22:00:00`) });
  assert.ok(tareaRango, 'el rango debe mover el inicio a las 22:00 y durar 90 minutos');

  // Errores de validación: no deben crear tareas ni romper la vista.
  const minutosInvalidos = await crearCon({ scheduledAt: `${fecha}T09:00`, durationMinutes: '5' });
  assert.strictEqual(minutosInvalidos.codigo, 422);
  assert.ok(minutosInvalidos.datos.errores.some((m) => /15 y 720/.test(m)));

  const horasInvalidas = await crearCon({ scheduledAt: `${fecha}T09:00`, durationMode: 'horas', durationHours: '13' });
  assert.strictEqual(horasInvalidas.codigo, 422);
  assert.ok(horasInvalidas.datos.errores.some((m) => /0.25 y 12/.test(m)));

  const rangoInvertido = await crearCon({
    scheduledAt: `${fecha}T09:00`,
    durationMode: 'rango',
    durationFrom: '10:00',
    durationTo: '09:30',
  });
  assert.strictEqual(rangoInvertido.codigo, 422);
  assert.ok(rangoInvertido.datos.errores.some((m) => /posterior/.test(m)));
  assert.strictEqual(await WorkTask.countDocuments({ title: 'Prueba duración' }), 2, 'las inválidas no deben guardarse');

  // Un rango que termina a las 00:00 cuenta como medianoche.
  const hastaMedianoche = await crearCon({
    scheduledAt: `${fecha}T23:00`,
    durationMode: 'rango',
    durationFrom: '23:00',
    durationTo: '00:00',
  });
  assert.ok(hastaMedianoche.redireccion, 'el rango 23:00-00:00 debe aceptarse');
  const nocturna = await WorkTask.findOne({ title: 'Prueba duración', scheduledAt: new Date(`${fecha}T23:00:00`) });
  assert.ok(nocturna, 'debe guardarse la tarea que termina a medianoche');
  assert.strictEqual(nocturna.durationMinutes, 60);

  // Edición: un rango inválido no debe tocar la tarea guardada.
  const edicionInvalida = respuesta();
  await agendaController.actualizar(
    {
      ...baseReq,
      params: { id: String(tareaHoras._id) },
      body: { scheduledAt: `${fecha}T20:00`, durationMode: 'rango', durationFrom: '10:00', durationTo: '09:00' },
    },
    edicionInvalida.res,
    (error) => { throw error; }
  );
  assert.strictEqual(edicionInvalida.estado.codigo, 422);
  assert.strictEqual((await WorkTask.findById(tareaHoras._id)).durationMinutes, 90, 'la edición inválida no debe guardar');

  const edicionHoras = respuesta();
  await agendaController.actualizar(
    {
      ...baseReq,
      params: { id: String(tareaHoras._id) },
      body: { scheduledAt: `${fecha}T20:00`, durationMode: 'horas', durationHours: '2.5' },
    },
    edicionHoras.res,
    (error) => { throw error; }
  );
  assert.ok(edicionHoras.estado.redireccion);
  assert.strictEqual((await WorkTask.findById(tareaHoras._id)).durationMinutes, 150, 'la edición en horas debe guardar 150 minutos');

  // Una tarea de madrugada queda fuera de la cuadrícula.
  const madrugada = await WorkTask.create({
    title: 'Madrugada',
    assignedTo: tecnico._id,
    scheduledAt: new Date(`${fecha}T00:30:00`),
    durationMinutes: 60,
    category: 'otro',
    priority: 'low',
  });
  const agendaFinal = respuesta();
  await agendaController.index(
    { usuario: admin, query: { fecha } },
    agendaFinal.res,
    (error) => { throw error; }
  );
  assert.strictEqual(agendaFinal.estado.datos.fuera.length, 1, 'la tarea de madrugada debe quedar fuera');
  assert.strictEqual(agendaFinal.estado.datos.fuera[0].title, 'Madrugada');

  await WorkTask.deleteMany({ title: 'Prueba duración' });
  await madrugada.deleteOne();
  await segunda.deleteOne();
  console.log('OK  Agenda: 8:00-24:00, duración en minutos/horas/rango, validaciones, carriles y estados.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
