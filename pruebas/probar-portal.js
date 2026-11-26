/**
 * Pruebas del portal de clientes: resumen, facturas, tickets y respuestas.
 * Uso: node pruebas/probar-portal.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Ticket = require('../models/Ticket');
const Invoice = require('../models/Invoice');
const portalController = require('../controllers/portalController');

function respuesta() {
  const estado = { datos: null, redireccion: '', codigo: 200, flash: [] };
  const res = {
    render: (vista, datos) => { estado.vista = vista; estado.datos = datos; },
    redirect: (url) => { estado.redireccion = url; },
    json: (datos) => { estado.datos = datos; },
    status: (codigo) => { estado.codigo = codigo; return res; },
  };
  return { res, estado };
}

function req(extra = {}) {
  return { flash: (tipo, mensaje) => { if (tipo === 'error' || tipo === 'exito') return; }, session: {}, query: {}, body: {}, params: {}, ...extra };
}

async function correr(controlador, peticion) {
  const salida = respuesta();
  await controlador(peticion, salida.res, (error) => { throw error; });
  return salida.estado;
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_portal');
  await mongoose.connection.db.dropDatabase();

  const cliente = await Client.create({
    clientCode: 'CL-PORTAL',
    firstName: 'Ana',
    lastName: 'Prueba',
    email: 'ana.portal@example.com',
    portalEnabled: true,
  });
  const otro = await Client.create({ clientCode: 'CL-OTRO', firstName: 'Otro', lastName: 'Cliente', portalEnabled: true });

  // 25 facturas: 7 pagadas, 3 vencidas y 15 pendientes.
  for (let i = 0; i < 25; i += 1) {
    const status = i < 7 ? 'paid' : i < 10 ? 'overdue' : 'open';
    await Invoice.create({
      invoiceNumber: `PORTAL-${String(i).padStart(3, '0')}`,
      clientId: cliente._id,
      type: i % 2 ? 'service' : 'other',
      lines: [{ description: 'Servicio', quantity: 1, unitPrice: 10, amount: 10 }],
      subtotal: 10,
      taxRate: 0,
      tax: 0,
      total: 10,
      issueDate: new Date(Date.now() - i * 86400000),
      dueDate: new Date(Date.now() + (10 - i) * 86400000),
      status,
      affectsService: status !== 'paid',
    });
  }
  // Ticket de otro cliente para comprobar el aislamiento.
  await Ticket.create({ code: 'TCK-AJENO', clientId: otro._id, subject: 'No debe verse', description: 'Ajeno' });

  const estadosTicket = ['open', 'in_progress', 'resolved', 'closed'];
  for (let i = 0; i < 15; i += 1) {
    await Ticket.create({
      code: `PT-${String(i).padStart(5, '0')}`,
      clientId: cliente._id,
      subject: `Asunto ${i}`,
      description: 'Detalle del problema',
      status: estadosTicket[Math.floor(i / 4)] || 'closed',
    });
  }

  // Resumen
  const resumen = await correr(portalController.index, req({ cliente }));
  assert.strictEqual(resumen.vista, 'portal/index');
  assert.strictEqual(resumen.datos.facturas.length, 5, 'el resumen muestra 5 facturas recientes');
  assert.strictEqual(resumen.datos.tickets.length, 5, 'el resumen muestra 5 tickets recientes');
  assert.strictEqual(resumen.datos.cuenta.facturas.total, 25);
  assert.strictEqual(resumen.datos.cuenta.facturas.pagadas, 7);
  assert.strictEqual(resumen.datos.cuenta.facturas.vencidas, 3);
  assert.strictEqual(resumen.datos.cuenta.facturas.pendientes, 18);
  assert.ok(resumen.datos.cuenta.deuda > 0);
  assert.ok(!resumen.datos.tickets.some((ticket) => ticket.code === 'TCK-AJENO'), 'no debe mostrar tickets de otro cliente');

  // Facturas paginadas
  const facturas1 = await correr(portalController.facturas, req({ cliente, query: {} }));
  assert.strictEqual(facturas1.datos.facturas.length, 10);
  assert.strictEqual(facturas1.datos.paginacion.paginas, 3);
  const facturas3 = await correr(portalController.facturas, req({ cliente, query: { pagina: '3' } }));
  assert.strictEqual(facturas3.datos.facturas.length, 5);
  const pagadas = await correr(portalController.facturas, req({ cliente, query: { estado: 'pagadas' } }));
  assert.strictEqual(pagadas.datos.facturas.length, 7);
  assert.ok(pagadas.datos.facturas.every((factura) => factura.status === 'paid'));
  const vencidas = await correr(portalController.facturas, req({ cliente, query: { estado: 'vencidas' } }));
  assert.strictEqual(vencidas.datos.facturas.length, 3);

  // Tickets filtrados
  const abiertos = await correr(portalController.tickets, req({ cliente, query: { estado: 'abiertos' } }));
  assert.strictEqual(abiertos.datos.tickets.length, 8);
  const resueltos = await correr(portalController.tickets, req({ cliente, query: { estado: 'resueltos' } }));
  assert.strictEqual(resueltos.datos.tickets.length, 4);

  // Crear ticket válido
  const alta = await correr(portalController.crearTicket, req({
    cliente,
    body: { subject: 'Sin internet', description: 'No tengo conexión desde ayer por la noche.', priority: 'high', category: 'billing' },
  }));
  assert.match(alta.redireccion, /^\/portal\/tickets\/[a-f0-9]{24}$/);
  const nuevo = await Ticket.findOne({ clientId: cliente._id, subject: 'Sin internet' });
  assert.ok(nuevo);
  assert.strictEqual(nuevo.priority, 'high');
  assert.strictEqual(nuevo.category, 'billing');
  assert.strictEqual(nuevo.status, 'open');

  // Ticket inválido: 422, conserva valores y no crea nada
  const antes = await Ticket.countDocuments({ clientId: cliente._id });
  const invalido = await correr(portalController.crearTicket, req({
    cliente,
    body: { subject: '', description: 'corto', priority: 'urgent', category: 'technical' },
  }));
  assert.strictEqual(invalido.codigo, 422);
  assert.strictEqual(invalido.vista, 'portal/ticket');
  assert.ok(invalido.datos.errores.length >= 2);
  assert.strictEqual(await Ticket.countDocuments({ clientId: cliente._id }), antes);

  // Responder un ticket
  const respuestaCliente = await correr(portalController.responderTicket, req({
    cliente,
    params: { id: String(nuevo._id) },
    body: { body: 'Sigo sin servicio, gracias.' },
  }));
  assert.match(respuestaCliente.redireccion, new RegExp(`/portal/tickets/${nuevo._id}`));
  const conMensaje = await Ticket.findById(nuevo._id);
  assert.strictEqual(conMensaje.messages.length, 1);
  assert.strictEqual(conMensaje.messages[0].internal, false);
  assert.strictEqual(conMensaje.messages[0].author, 'Ana Prueba');

  // Un ticket de otro cliente no se puede responder
  const ajeno = await Ticket.findOne({ code: 'TCK-AJENO' });
  const intentoAjeno = await correr(portalController.responderTicket, req({
    cliente,
    params: { id: String(ajeno._id) },
    body: { body: 'Intento ajeno' },
  }));
  assert.match(intentoAjeno.redireccion, /^\/portal\/tickets$/);
  assert.strictEqual((await Ticket.findById(ajeno._id)).messages.length, 0);

  // Tema del portal persistido por cliente
  const tema = await correr(portalController.guardarTema, req({ cliente, body: { tema: 'oscuro' } }));
  assert.strictEqual(tema.datos.ok, true);
  assert.strictEqual((await Client.findById(cliente._id)).portalTheme, 'oscuro');
  const temaInvalido = await correr(portalController.guardarTema, req({ cliente, body: { tema: 'neón' } }));
  assert.strictEqual(temaInvalido.codigo, 422);

  // Un cliente retirado no puede entrar al portal aunque tenga clave.
  const { hashPassword } = require('../utils/password');
  await Client.create({
    clientCode: 'CL-RET',
    firstName: 'Re',
    lastName: 'Tirado',
    portalEnabled: true,
    status: 'retired',
    portalPasswordHash: hashPassword('clave123'),
  });
  const retirado = await correr(
    portalController.login,
    req({ body: { clientCode: 'CL-RET', password: 'clave123' }, ip: '127.0.0.1' })
  );
  assert.strictEqual(retirado.codigo, 401, 'el cliente retirado no debe autenticarse');
  assert.ok(!retirado.redireccion, 'no debe redirigir al portal');

  console.log('OK  Portal: resumen, facturas filtradas, tickets, creación, respuesta, tema, aislamiento y retirados.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
