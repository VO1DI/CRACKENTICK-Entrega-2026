/**
 * Pruebas del módulo de clientes: alta, búsqueda/filtros, edición, borrado
 * protegido, alta de servicio con IP de pool, MAC duplicada y API de IPs.
 *
 * Uso: node pruebas/probar-clientes.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Router = require('../models/Router');
const IpPool = require('../models/IpPool');
const Subscription = require('../models/Subscription');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const clientController = require('../controllers/clientController');

function respuesta() {
  const estado = { redireccion: '', datos: null, codigo: 200 };
  const res = {
    redirect: (url) => { estado.redireccion = url; },
    render: (vista, datos) => { estado.vista = vista; estado.datos = datos; },
    json: (datos) => { estado.datos = datos; },
    status: (codigo) => { estado.codigo = codigo; return res; },
  };
  return { res, estado };
}

function req(extra = {}) {
  return { usuario: { username: 'admin-prueba', role: 'admin' }, flash: () => {}, session: {}, query: {}, body: {}, params: {}, ...extra };
}

async function correr(accion, controlador, peticion) {
  const salida = respuesta();
  await controlador(peticion, salida.res, (error) => { throw error; });
  return salida.estado;
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_clientes');
  await mongoose.connection.db.dropDatabase();

  // Host vacío: el aprovisionamiento falla y el servicio queda en estado de error, que es lo esperado en la prueba.
  const router = await Router.create({ name: 'Router Clientes', host: '', active: true, planMode: 'simple_queue' });
  const plan = await Plan.create({
    name: 'Plan Clientes 50',
    downloadSpeed: 50,
    uploadSpeed: 10,
    price: 500,
    trafficMode: 'simple_queue',
    active: true,
  });
  const pool = await IpPool.create({ name: 'Pool Clientes', cidr: '10.50.0.0/29', routerId: router._id, active: true });
  const admin = new User({ name: 'Admin', username: 'admin-prueba', role: 'admin', active: true });
  admin.establecerPassword('prueba123');
  await admin.save();

  // Alta
  const alta = await correr('crear', clientController.crear, req({
    body: {
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      phone: '0414-0000000',
      'address.street': 'Calle 1',
      'address.city': 'Caracas',
      status: 'active',
    },
  }));
  const ana = await Client.findOne({ email: 'ana@example.com' });
  assert.ok(ana, 'el cliente debe crearse');
  assert.match(ana.clientCode, /^CL-\d{4,}$/, 'el código debe generarse');
  assert.strictEqual(ana.address.city, 'Caracas');
  assert.match(alta.redireccion, new RegExp(`/clientes/${ana._id}`));

  // Segundo cliente para filtros
  const alta2 = await correr('crear', clientController.crear, req({
    body: { firstName: 'Luis', lastName: 'Gómez', email: 'luis@example.com', status: 'suspended' },
  }));
  const luis = await Client.findById(alta2.redireccion.match(/clientes\/([a-f0-9]+)/)[1]);

  // Búsqueda y filtros
  const busqueda = await correr('index', clientController.index, req({ query: { q: 'ana' } }));
  assert.strictEqual(busqueda.datos.clientes.length, 1, 'la búsqueda debe filtrar por nombre');
  assert.strictEqual(busqueda.datos.clientes[0].email, 'ana@example.com');

  const suspendidos = await correr('index', clientController.index, req({ query: { estado: 'suspended' } }));
  assert.strictEqual(suspendidos.datos.clientes.length, 1, 'el filtro por estado debe funcionar');
  assert.strictEqual(suspendidos.datos.clientes[0].email, 'luis@example.com');

  const conDeuda = await correr('index', clientController.index, req({ query: { deuda: '1' } }));
  assert.strictEqual(conDeuda.datos.clientes.length, 0, 'sin facturas no hay deudores');

  // Edición
  const edicion = await correr('actualizar', clientController.actualizar, req({
    params: { id: String(luis._id) },
    body: { firstName: 'Luis', lastName: 'Gómez', email: 'luis@example.com', phone: '0424-1111111', status: 'active' },
  }));
  const luisEditado = await Client.findById(luis._id);
  assert.strictEqual(luisEditado.phone, '0424-1111111');
  assert.strictEqual(luisEditado.status, 'active');
  assert.match(edicion.redireccion, new RegExp(`/clientes/${luis._id}`));

  // Validación: falta el nombre
  const invalido = await correr('crear', clientController.crear, req({ body: { firstName: 'A', lastName: 'B' } }));
  assert.strictEqual(invalido.codigo, 422, 'un cliente inválido debe devolver 422');
  assert.strictEqual(invalido.vista, 'clients/form');

  // Servicio con IP automática del pool y usuario PPPoE generado
  const servicio = await correr('crearServicio', clientController.crearServicio, req({
    params: { id: String(ana._id) },
    body: { planId: String(plan._id), connectionType: 'pppoe', routerId: String(router._id), ipPoolId: String(pool._id) },
  }));
  const suscripcion = await Subscription.findOne({ clientId: ana._id });
  assert.ok(suscripcion, 'el servicio debe crearse');
  assert.strictEqual(suscripcion.serviceConfig.ipAddress, '10.50.0.1', 'debe tomar la primera IP libre');
  assert.ok(suscripcion.serviceConfig.pppoeUsername, 'debe generar usuario PPPoE');
  assert.strictEqual(suscripcion.planSnapshot.name, plan.name);
  assert.match(servicio.redireccion, /\?tab=servicio$/);

  // Un cliente no puede tener dos servicios
  const repetido = await correr('crearServicio', clientController.crearServicio, req({
    params: { id: String(ana._id) },
    body: { planId: String(plan._id), connectionType: 'pppoe', routerId: String(router._id) },
  }));
  assert.match(repetido.redireccion, /\?tab=servicio$/, 'debe volver a la pestaña del servicio');
  assert.strictEqual(await Subscription.countDocuments({ clientId: ana._id }), 1);

  // Servicio con MAC autenticada
  const mac = 'AA:BB:CC:DD:EE:01';
  const conMac = await correr('crearServicio', clientController.crearServicio, req({
    params: { id: String(luis._id) },
    body: {
      planId: String(plan._id),
      connectionType: 'static',
      routerId: String(router._id),
      ipPoolId: String(pool._id),
      macAddress: mac,
      macAuthEnabled: 'on',
    },
  }));
  assert.match(conMac.redireccion, /\?tab=servicio$/);
  const conMacGuardada = await Subscription.findOne({ clientId: luis._id });
  assert.strictEqual(conMacGuardada.serviceConfig.macAddress, mac);

  // Otro cliente con la misma MAC: se rechaza
  const alta3 = await correr('crear', clientController.crear, req({
    body: { firstName: 'Pepe', lastName: 'Rojas', email: 'pepe@example.com', status: 'active' },
  }));
  const pepe = await Client.findById(alta3.redireccion.match(/clientes\/([a-f0-9]+)/)[1]);
  const macRepetida = await correr('crearServicio', clientController.crearServicio, req({
    params: { id: String(pepe._id) },
    body: {
      planId: String(plan._id),
      connectionType: 'static',
      routerId: String(router._id),
      ipPoolId: String(pool._id),
      macAddress: mac,
      macAuthEnabled: 'on',
    },
  }));
  assert.strictEqual(macRepetida.codigo, 422, 'MAC repetida debe rechazarse');
  assert.match(String(macRepetida.datos.erroresCampo?.macAddress || macRepetida.datos.errores), /MAC/i);

  // API de IPs: las dos primeras ya están ocupadas
  const ips = await correr('apiIpsPool', clientController.apiIpsPool, req({
    params: { poolId: String(pool._id) },
    query: { actual: '' },
  }));
  assert.strictEqual(ips.datos.ok, true);
  assert.ok(!ips.datos.ips.includes('10.50.0.1'), 'la IP asignada no debe ofrecerse');
  assert.ok(!ips.datos.ips.includes('10.50.0.2'), 'la segunda IP asignada tampoco');
  assert.ok(ips.datos.ips.includes('10.50.0.3'), 'la siguiente IP debe estar libre');

  // Borrado bloqueado por factura
  await Invoice.create({
    invoiceNumber: 'F-0001',
    clientId: ana._id,
    issueDate: new Date(),
    dueDate: new Date(),
    status: 'open',
    lines: [{ description: 'Servicio', quantity: 1, unitPrice: 10, amount: 10 }],
    subtotal: 10,
    taxRate: 0,
    tax: 0,
    total: 10,
  });
  const bloqueado = await correr('eliminar', clientController.eliminar, req({ params: { id: String(ana._id) } }));
  assert.match(bloqueado.redireccion, new RegExp(`/clientes/${ana._id}\\?tab=general`));
  assert.ok(await Client.findById(ana._id), 'no debe borrarse un cliente con registros');

  // Borrado limpio
  await correr('eliminar', clientController.eliminar, req({ params: { id: String(pepe._id) } }));
  assert.strictEqual(await Client.findById(pepe._id), null, 'un cliente sin registros sí se borra');

  console.log('OK  Clientes: alta, filtros, edición, servicio, MAC, IPs y borrado protegido.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
