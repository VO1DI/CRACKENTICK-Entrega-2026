/**
 * Pruebas de tickets: alta, respuesta, estado, prioridad y alta desde el portal.
 * Uso: node pruebas/probar-tickets.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const Ticket = require('../models/Ticket');
const Alert = require('../models/Alert');
const User = require('../models/User');
const ticketController = require('../controllers/ticketController');
const portalController = require('../controllers/portalController');

function respuesta() {
  const estado = { redireccion: '', datos: null, codigo: 200 };
  const res = {
    redirect: (url) => { estado.redireccion = url; },
    render: (vista, datos) => { estado.vista = vista; estado.datos = datos; },
    status: (codigo) => { estado.codigo = codigo; return res; },
  };
  return { res, estado };
}

function req(extra = {}) {
  return { usuario: { username: 'admin-tickets', name: 'Admin' }, flash: () => {}, session: {}, query: {}, body: {}, params: {}, ...extra };
}

async function correr(controlador, peticion) {
  const salida = respuesta();
  await controlador(peticion, salida.res, (error) => { throw error; });
  return salida.estado;
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_tickets');
  await mongoose.connection.db.dropDatabase();

  const admin = new User({ name: 'Admin', username: 'admin-tickets', role: 'admin', active: true });
  admin.establecerPassword('prueba123');
  await admin.save();
  const cliente = await Client.create({ clientCode: 'CL-9001', firstName: 'Tere', lastName: 'Soporte', email: 'tere@example.com' });

  const alta = await correr(ticketController.crear, req({
    body: {
      clientId: String(cliente._id),
      subject: 'Sin internet',
      description: 'El cliente reporta caída total.',
      category: 'technical',
      priority: 'high',
      assignedTo: 'Soporte',
      mensajeInicial: 'Llamada recibida.',
    },
  }));
  const ticket = await Ticket.findOne({ clientId: cliente._id });
  assert.ok(ticket, 'el ticket debe crearse');
  assert.match(ticket.code, /^TCK-\d{5,}$/);
  assert.strictEqual(ticket.priority, 'high');
  assert.strictEqual(ticket.messages.length, 1);
  assert.match(alta.redireccion, new RegExp(`/tickets/${ticket._id}`));

  const aviso = await Alert.findOne({ type: 'ticket_new', ticketId: ticket._id });
  assert.ok(aviso, 'el ticket debe generar una notificación');
  assert.strictEqual(aviso.link, `/soporte/tickets/${ticket._id}`);
  assert.strictEqual(aviso.severity, 'warning', 'prioridad alta genera aviso de advertencia');

  const respuesta = await correr(ticketController.responder, req({
    params: { id: String(ticket._id) },
    body: { body: 'Técnico asignado.', internal: 'on' },
  }));
  let actualizado = await Ticket.findById(ticket._id);
  assert.strictEqual(actualizado.messages.length, 2);
  assert.strictEqual(actualizado.messages[1].internal, true);
  assert.strictEqual(actualizado.status, 'in_progress', 'responder abre el ticket');
  assert.match(respuesta.redireccion, new RegExp(`/tickets/${ticket._id}`));

  await correr(ticketController.cambiarPrioridad, req({
    params: { id: String(ticket._id) },
    body: { priority: 'urgent' },
  }));
  actualizado = await Ticket.findById(ticket._id);
  assert.strictEqual(actualizado.priority, 'urgent');

  await correr(ticketController.cambiarEstado, req({
    params: { id: String(ticket._id) },
    body: { status: 'resolved' },
  }));
  actualizado = await Ticket.findById(ticket._id);
  assert.strictEqual(actualizado.status, 'resolved');
  assert.ok(actualizado.resolvedAt);
  const avisoResuelto = await Alert.findById(aviso._id);
  assert.strictEqual(avisoResuelto.status, 'resolved', 'resolver el ticket cierra su aviso');

  await correr(ticketController.cambiarEstado, req({
    params: { id: String(ticket._id) },
    body: { status: 'closed' },
  }));
  actualizado = await Ticket.findById(ticket._id);
  assert.strictEqual(actualizado.status, 'closed');
  assert.ok(actualizado.closedAt);

  // Portal: la prioridad "Crítica" debe guardarse como `urgent`, no romper el modelo.
  const portal = await correr(portalController.crearTicket, req({
    cliente,
    params: {},
    body: { subject: 'Clave WiFi', description: 'No recuerdo la clave.', priority: 'urgent' },
  }));
  const desdePortal = await Ticket.findOne({ subject: 'Clave WiFi' });
  assert.ok(desdePortal, 'el ticket del portal debe crearse');
  assert.strictEqual(desdePortal.priority, 'urgent');
  assert.strictEqual(String(desdePortal.clientId), String(cliente._id));
  assert.match(portal.redireccion, /\/portal\/tickets\/[a-f0-9]{24}$/);
  assert.ok(
    await Alert.findOne({ type: 'ticket_new', ticketId: desdePortal._id }),
    'el ticket del portal también genera notificación'
  );

  // Un valor viejo (`critical`) no debe romper: cae a media.
  await correr(portalController.crearTicket, req({
    cliente,
    params: {},
    body: { subject: 'Otra consulta', description: 'Necesito más detalle sobre mi factura.', priority: 'critical' },
  }));
  const viejo = await Ticket.findOne({ subject: 'Otra consulta' });
  assert.strictEqual(viejo.priority, 'medium', 'una prioridad desconocida cae a media');

  console.log('OK  Tickets: alta, respuesta, prioridad, estados y portal.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
