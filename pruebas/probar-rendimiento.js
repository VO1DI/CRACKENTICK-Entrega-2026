/**
 * Pruebas de rendimiento por empleado: promedio por tarea y por tipo.
 * Uso: node pruebas/probar-rendimiento.js
 */
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const WorkTask = require('../models/WorkTask');
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');
const statsController = require('../controllers/statsController');
const taskTypeService = require('../services/taskTypeService');

function respuesta() {
  const estado = { datos: null };
  const res = {
    render: (vista, datos) => { estado.vista = vista; estado.datos = datos; },
    status: () => res,
  };
  return { res, estado };
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/crackentick_test_rendimiento');
  await mongoose.connection.db.dropDatabase();
  await taskTypeService.asegurarTipos();

  const usuario = new User({ name: 'Técnico Rendimiento', username: 'tecnico-rendimiento', role: 'staff', active: true });
  usuario.establecerPassword('prueba123');
  await usuario.save();
  const empleado = await Employee.create({
    name: 'Técnico Rendimiento',
    position: 'Soporte',
    area: 'soporte',
    salary: 100,
    userId: usuario._id,
    active: true,
  });

  const base = new Date(Date.now() - 86400000);
  const hora = (delta) => new Date(base.getTime() + delta * 3600000);
  const crear = (category, inicio, fin, status = 'done') => WorkTask.create({
    title: `Tarea ${category}`,
    assignedTo: usuario._id,
    scheduledAt: hora(inicio),
    durationMinutes: 60,
    category,
    status,
    startedAt: status === 'done' ? hora(inicio) : null,
    finishedAt: status === 'done' ? hora(fin) : null,
  });

  await crear('soporte', 8, 10);
  await crear('soporte', 11, 11.5);
  await crear('instalacion', 12, 14);
  await crear('otro', 15, 16, 'pending');

  const salida = respuesta();
  await statsController.index(
    { usuario: { role: 'admin', username: 'admin' }, query: { dias: '30', empleado: String(empleado._id) } },
    salida.res,
    (error) => { throw error; }
  );
  const datos = salida.estado.datos;
  assert.ok(datos, 'debe renderizar');
  assert.strictEqual(datos.altasBajas, undefined, 'no debe enviar la sección de altas y bajas');
  assert.strictEqual(datos.seleccionado.tareasAsignadas, 4);
  assert.strictEqual(datos.seleccionado.tareasHechas, 3);
  assert.strictEqual(datos.seleccionado.promedioHorasTarea, 1.5, 'promedio global de 2 h, 0.5 h y 2 h');
  assert.strictEqual(datos.seleccionado.promedioPorTipo.soporte, 1.25, 'promedio de soporte');
  assert.strictEqual(datos.seleccionado.promedioPorTipo.instalacion, 2, 'promedio de instalación');
  assert.strictEqual(datos.seleccionado.tareasPorTipo.soporte, 2);
  assert.strictEqual(datos.categoriasTarea.soporte, 'Soporte');

  /* Cobrado: usa el total USD de la factura aunque el log viejo no traiga importe. */
  const cliente = await Client.create({ clientCode: 'CL-REND', firstName: 'Cliente', lastName: 'Rendimiento' });
  const facturaLegacy = await Invoice.create({
    invoiceNumber: 'REND-LEGACY',
    clientId: cliente._id,
    type: 'service',
    dueDate: new Date(),
    lines: [{ description: 'Servicio', quantity: 1, unitPrice: 40.6, amount: 40.6 }],
    subtotal: 40.6,
    taxRate: 0,
    tax: 0,
    total: 40.6,
    status: 'paid',
    affectsService: false,
  });
  const facturaBs = await Invoice.create({
    invoiceNumber: 'REND-BS',
    clientId: cliente._id,
    type: 'service',
    dueDate: new Date(),
    lines: [{ description: 'Servicio', quantity: 1, unitPrice: 10, amount: 10 }],
    subtotal: 10,
    taxRate: 0,
    tax: 0,
    total: 10,
    status: 'paid',
    affectsService: false,
  });
  await AuditLog.create({
    module: 'financial',
    entity: 'Invoice',
    entityId: String(facturaLegacy._id),
    action: 'payment',
    description: 'Pago viejo sin importe en auditoría.',
    changes: { after: { status: 'paid' } },
    status: 'success',
    actor: 'tecnico-rendimiento',
  });
  await AuditLog.create({
    module: 'financial',
    entity: 'Invoice',
    entityId: String(facturaBs._id),
    action: 'payment',
    description: 'Pago en bolívares.',
    changes: { after: { status: 'paid', paymentCurrency: 'VES', paymentAmount: 365, exchangeRate: 36.5 } },
    status: 'success',
    actor: 'tecnico-rendimiento',
  });

  const salidaCobros = respuesta();
  await statsController.index(
    { usuario: { role: 'admin', username: 'admin' }, query: { dias: '30', empleado: String(empleado._id) } },
    salidaCobros.res,
    (error) => { throw error; }
  );
  const cobros = salidaCobros.estado.datos;
  assert.strictEqual(cobros.seleccionado.pagos, 2, 'debe contar los dos pagos');
  assert.strictEqual(cobros.seleccionado.cobrado, 50.6, 'debe sumar USD de factura: 40.60 + 10.00');
  assert.strictEqual(cobros.resumen.cobrado, 50.6, 'el total no debe mezclar bolívares con dólares');

  console.log('OK  Rendimiento: promedio por tarea y por tipo, sin altas y bajas; cobrado en USD.');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (error) => {
  console.error('FALLO', error.message);
  await mongoose.connection.db?.dropDatabase().catch(() => null);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
