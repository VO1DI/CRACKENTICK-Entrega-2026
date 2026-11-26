const mongoose = require('mongoose');
const FaultReport = require('../models/FaultReport');
const InstallationReport = require('../models/InstallationReport');
const Zone = require('../models/Zone');
const Client = require('../models/Client');
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const { registrar } = require('../services/auditService');
const staffService = require('../services/staffService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const {
  PRIORIDADES_TICKET,
  ESTADOS_AVERIA,
} = require('../config/constants');
const { fechaLocal, inicioDelDia, finDelDia, fechaParaInput } = require('../utils/dates');

const ORDEN_PRIORIDAD = { urgent: 0, high: 1, medium: 2, low: 3 };

function hoyISO() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function fechaDelFiltro(valor) {
  const texto = String(valor || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : hoyISO();
}

function fechaDeCampo(valor, respaldo = null) {
  if (!valor) return respaldo;
  const fecha = fechaLocal(valor);
  return Number.isNaN(fecha.getTime()) ? respaldo : fecha;
}

async function opcionesFormulario() {
  const [zonas, clientes, tickets, usuarios] = await Promise.all([
    Zone.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
    Client.find().sort({ firstName: 1, lastName: 1 }).lean(),
    Ticket.find({ status: { $in: ['open', 'in_progress'] } }).populate('clientId').sort({ createdAt: -1 }).lean(),
    User.find({ active: true }).select('name').sort({ name: 1 }).lean(),
  ]);
  return { zonas, clientes, tickets, tecnicos: usuarios.map((u) => u.name) };
}

async function resolverTicket(ticketId) {
  if (!ticketId) return null;
  if (!mongoose.isValidObjectId(ticketId)) throw crearError(422, 'El ticket seleccionado no existe.');
  const ticket = await Ticket.findById(ticketId).populate('clientId');
  if (!ticket) throw crearError(422, 'El ticket seleccionado no existe.');
  return ticket;
}

/** GET /red/reportes/averias */
async function index(req, res, next) {
  try {
    const fecha = fechaDelFiltro(req.query.fecha);
    const zonaFiltro = String(req.query.zona || '');
    const estado = ESTADOS_AVERIA.includes(req.query.estado) ? req.query.estado : '';
    const desde = inicioDelDia(fecha);
    const hasta = finDelDia(fecha);

    const consulta = { faultDate: { $gte: desde, $lte: hasta } };
    if (ESTADOS_AVERIA.includes(estado)) consulta.status = estado;
    if (zonaFiltro === 'sin') consulta.zoneId = null;
    else if (mongoose.isValidObjectId(zonaFiltro)) consulta.zoneId = zonaFiltro;

    const [zonas, reportes, instalaciones] = await Promise.all([
      Zone.find().sort({ order: 1, name: 1 }).lean(),
      FaultReport.find(consulta)
        .populate('clientId')
        .populate('ticketId')
        .sort({ reportedAt: 1 })
        .lean(),
      InstallationReport.aggregate([
        { $match: { installedAt: { $gte: desde, $lte: hasta } } },
        { $group: { _id: '$zoneId', total: { $sum: 1 } } },
      ]),
    ]);

    reportes.sort(
      (a, b) =>
        (ORDEN_PRIORIDAD[a.priority] ?? 9) - (ORDEN_PRIORIDAD[b.priority] ?? 9) ||
        new Date(a.reportedAt) - new Date(b.reportedAt)
    );

    const mapaZonas = new Map(
      zonas.map((zona) => [String(zona._id), { _id: String(zona._id), nombre: zona.name, activa: zona.active, averias: [], instalaciones: 0 }])
    );
    const sinZona = { _id: null, nombre: 'Sin zona', activa: true, averias: [], instalaciones: 0 };

    reportes.forEach((reporte) => {
      const clave = reporte.zoneId ? String(reporte.zoneId._id || reporte.zoneId) : null;
      const grupo = (clave && mapaZonas.get(clave)) || sinZona;
      grupo.averias.push(reporte);
    });
    instalaciones.forEach((fila) => {
      const grupo = fila._id ? mapaZonas.get(String(fila._id)) : sinZona;
      if (grupo) grupo.instalaciones = fila.total;
    });

    const grupos = [...mapaZonas.values()].filter((zona) => zona.activa || zona.averias.length || zona.instalaciones);
    if (sinZona.averias.length || sinZona.instalaciones) grupos.push(sinZona);

    const resumen = {
      total: reportes.length,
      solventadas: reportes.filter((r) => r.status === 'solved').length,
      enProceso: reportes.filter((r) => r.status === 'in_progress').length,
      sinSolventar: reportes.filter((r) => r.status === 'unsolved').length,
      instalaciones: instalaciones.reduce((total, fila) => total + fila.total, 0),
    };

    const grafico = grupos
      .filter((grupo) => grupo.averias.length)
      .map((grupo) => {
        const solventadas = grupo.averias.filter((r) => r.status === 'solved').length;
        return { zona: grupo.nombre, solventadas, pendientes: grupo.averias.length - solventadas };
      });

    res.render('reports/faults', {
      titulo: 'Reporte de averías',
      fecha,
      filtros: { fecha, zona: zonaFiltro, estado },
      zonas,
      grupos,
      grafico,
      resumen,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /red/reportes/averias/nuevo */
async function formNuevo(req, res, next) {
  try {
    const datos = await opcionesFormulario();
    res.render('reports/fault-form', {
      titulo: 'Nueva avería',
      reporte: new FaultReport({ faultDate: new Date(), reportedAt: new Date(), priority: 'medium', status: 'unsolved' }),
      ...datos,
      modo: 'crear',
      errores: [],
      erroresCampo: {},
      valores: {},
    });
  } catch (error) {
    next(error);
  }
}

function payloadReporte(body = {}) {
  return {
    zoneId: mongoose.isValidObjectId(body.zoneId) ? body.zoneId : null,
    priority: PRIORIDADES_TICKET.includes(body.priority) ? body.priority : 'medium',
    faultDate: fechaDeCampo(body.faultDate, new Date()),
    reportedAt: fechaDeCampo(body.reportedAt, new Date()),
    clientId: mongoose.isValidObjectId(body.clientId) ? body.clientId : null,
    clientName: String(body.clientName || '').trim().slice(0, 120),
    problem: String(body.problem || '').trim().slice(0, 300),
    note: String(body.note || '').trim().slice(0, 500),
    technician: String(body.technician || '').trim().slice(0, 80),
    location: String(body.location || '').trim().slice(0, 200),
    status: ESTADOS_AVERIA.includes(body.status) ? body.status : 'unsolved',
    ticketId: mongoose.isValidObjectId(body.ticketId) ? body.ticketId : null,
  };
}

/** Aplica los datos del ticket vinculado y bloquea los campos que él controla. */
async function aplicarTicket(datos) {
  if (!datos.ticketId) return null;
  const ticket = await resolverTicket(datos.ticketId);
  const cliente = ticket.clientId;
  datos.clientId = cliente?._id || null;
  datos.clientName = cliente ? `${cliente.firstName} ${cliente.lastName}`.trim() : '';
  datos.problem = `${ticket.subject}: ${ticket.description}`.slice(0, 300);
  datos.priority = ticket.priority;
  if (!datos.technician) datos.technician = ticket.assignedTo || '';
  return ticket;
}

async function anotarTicket(reporte, ticket, autor) {
  if (!ticket) return;
  ticket.messages.push({
    author: String(autor || 'Soporte').slice(0, 80),
    body: `Avería solventada: ${reporte.problem.slice(0, 160)}${reporte.note ? `. Nota: ${reporte.note}` : ''}`.slice(0, 2000),
    internal: true,
  });
  if (ticket.status === 'open') ticket.status = 'in_progress';
  await ticket.save();
  await registrar({
    module: 'support',
    entity: 'Ticket',
    entityId: ticket._id,
    action: 'reply',
    description: `Nota interna agregada al ticket ${ticket.code} por una avería solventada.`,
    changes: { after: { status: ticket.status } },
  });
}

/** POST /red/reportes/averias */
async function crear(req, res, next) {
  try {
    const datos = payloadReporte(req.body);
    if (!datos.problem) {
      const error = crearError(422, 'El problema es obligatorio.');
      error.campos = { problem: 'Describe el problema reportado.' };
      throw error;
    }
    const ticket = await aplicarTicket(datos);
    datos.technicianId = await staffService.usuarioPorNombre(datos.technician);

    const reporte = new FaultReport(datos);
    if (reporte.status === 'solved') reporte.resolvedAt = new Date();
    await reporte.save();
    if (reporte.status === 'solved') await anotarTicket(reporte, ticket, reporte.technician);

    await registrar({
      module: 'technical',
      entity: 'FaultReport',
      entityId: reporte._id,
      action: 'create',
      description: `Avería registrada${reporte.clientName ? ` para ${reporte.clientName}` : ''}: ${reporte.problem.slice(0, 80)}.`,
      changes: { after: { priority: reporte.priority, status: reporte.status, ticketId: reporte.ticketId } },
    });

    req.flash('exito', 'Avería registrada en el reporte diario.');
    res.redirect(`/red/reportes/averias?fecha=${fechaParaInput(reporte.faultDate)}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const datos = await opcionesFormulario();
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('reports/fault-form', {
        titulo: 'Nueva avería',
        reporte: new FaultReport(payloadReporte(req.body)),
        ...datos,
        modo: 'crear',
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

/** GET /red/reportes/averias/:id/editar */
async function formEditar(req, res, next) {
  try {
    const reporte = await FaultReport.findById(req.params.id).populate('clientId');
    if (!reporte) throw crearError(404, 'La avería no existe.');
    const datos = await opcionesFormulario();
    res.render('reports/fault-form', {
      titulo: 'Editar avería',
      reporte,
      ...datos,
      modo: 'editar',
      errores: [],
      erroresCampo: {},
      valores: {},
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /red/reportes/averias/:id */
async function actualizar(req, res, next) {
  try {
    const reporte = await FaultReport.findById(req.params.id);
    if (!reporte) throw crearError(404, 'La avería no existe.');
    const anterior = reporte.status;

    const datos = payloadReporte(req.body);
    if (!datos.problem) {
      const error = crearError(422, 'El problema es obligatorio.');
      error.campos = { problem: 'Describe el problema reportado.' };
      throw error;
    }
    const ticket = await aplicarTicket(datos);
    datos.technicianId = await staffService.usuarioPorNombre(datos.technician);

    Object.assign(reporte, datos);
    if (reporte.status === 'solved') {
      reporte.resolvedAt = reporte.resolvedAt || new Date();
    } else {
      reporte.resolvedAt = undefined;
    }
    await reporte.save();
    if (anterior !== 'solved' && reporte.status === 'solved') {
      await anotarTicket(reporte, ticket, reporte.technician);
    }

    await registrar({
      module: 'technical',
      entity: 'FaultReport',
      entityId: reporte._id,
      action: 'update',
      description: `Avería actualizada: ${reporte.problem.slice(0, 80)}.`,
      changes: { before: { status: anterior }, after: { status: reporte.status } },
    });

    req.flash('exito', 'Avería actualizada.');
    res.redirect(`/red/reportes/averias?fecha=${fechaParaInput(reporte.faultDate)}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const datos = await opcionesFormulario();
      const reporte = await FaultReport.findById(req.params.id);
      if (reporte) Object.assign(reporte, payloadReporte(req.body));
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('reports/fault-form', {
        titulo: 'Editar avería',
        reporte: reporte || new FaultReport(payloadReporte(req.body)),
        ...datos,
        modo: 'editar',
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

/** POST /red/reportes/averias/:id/estado */
async function cambiarEstado(req, res, next) {
  try {
    const reporte = await FaultReport.findById(req.params.id);
    if (!reporte) throw crearError(404, 'La avería no existe.');
    const estado = req.body.status;
    if (!ESTADOS_AVERIA.includes(estado)) throw crearError(422, 'Estado de avería no válido.');
    const anterior = reporte.status;
    reporte.status = estado;
    reporte.resolvedAt = estado === 'solved' ? new Date() : undefined;
    await reporte.save();

    if (anterior !== 'solved' && estado === 'solved') {
      const ticket = reporte.ticketId ? await Ticket.findById(reporte.ticketId) : null;
      await anotarTicket(reporte, ticket, reporte.technician);
    }

    await registrar({
      module: 'technical',
      entity: 'FaultReport',
      entityId: reporte._id,
      action: 'update',
      description: `Avería: ${anterior} → ${estado}.`,
      changes: { before: { status: anterior }, after: { status: estado } },
    });
    req.flash('exito', 'Estado de la avería actualizado.');
    res.redirect(`/red/reportes/averias?fecha=${fechaParaInput(reporte.faultDate)}`);
  } catch (error) {
    next(error);
  }
}

/** DELETE /red/reportes/averias/:id */
async function eliminar(req, res, next) {
  try {
    const reporte = await FaultReport.findById(req.params.id);
    if (!reporte) throw crearError(404, 'La avería no existe.');
    await reporte.deleteOne();
    await registrar({
      module: 'technical',
      entity: 'FaultReport',
      entityId: reporte._id,
      action: 'delete',
      description: `Avería eliminada: ${reporte.problem.slice(0, 80)}.`,
      changes: { before: { status: reporte.status, client: reporte.clientName } },
    });
    req.flash('exito', 'Avería eliminada.');
    res.redirect(`/red/reportes/averias?fecha=${fechaParaInput(reporte.faultDate)}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar, cambiarEstado, eliminar };
