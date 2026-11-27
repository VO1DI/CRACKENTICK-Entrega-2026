const mongoose = require('mongoose');
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const Ticket = require('../models/Ticket');
const Subscription = require('../models/Subscription');
const { verifyPassword } = require('../utils/password');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { crearLimite } = require('../utils/rateLimit');
const ticketAlertService = require('../services/ticketAlertService');

const PENDIENTES = ['open', 'overdue'];
const POR_PAGINA = 10;
const CATEGORIAS = ['technical', 'billing', 'installation', 'other'];
const PRIORIDADES = ['low', 'medium', 'high', 'urgent'];
const limite = crearLimite({ max: 5 });
const limiteIp = crearLimite({ max: 100 });

function pagina(valor, total) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  return { actual: Math.min(paginas, Math.max(1, Number(valor) || 1)), paginas, total };
}

function rango(offset) {
  return { skip: (offset - 1) * POR_PAGINA, limit: POR_PAGINA };
}

/** Middleware: exige una sesión de cliente con portal habilitado. */
async function requiereCliente(req, res, next) {
  try {
    const id = req.session && req.session.clienteId;
    if (!id) return res.redirect('/portal/login');
    const cliente = await Client.findById(id);
    if (!cliente || !cliente.portalEnabled || cliente.status === 'retired') {
      req.session.clienteId = null;
      return res.redirect('/portal/login');
    }
    req.cliente = cliente;
    res.locals.clientePortal = cliente;
    res.locals.temaPortal = cliente.portalTheme || 'claro-suave';
    return next();
  } catch (error) {
    return next(error);
  }
}

function loginForm(req, res) {
  if (req.session && req.session.clienteId) return res.redirect('/portal');
  return res.render('portal/login', {
    titulo: 'Entrar al portal',
    layout: 'layouts/portal',
    auth: true,
    valores: {},
    error: null,
  });
}

async function login(req, res, next) {
  try {
    const codigo = String(req.body.clientCode || '').trim().toUpperCase();
    const clave = String(req.body.password || '');
    const ip = req.ip || 'local';
    const llave = `${ip}:${codigo}`;
    const responder = (mensaje, status = 401) =>
      res.status(status).render('portal/login', {
        titulo: 'Entrar al portal',
        layout: 'layouts/portal',
        auth: true,
        valores: { clientCode: codigo },
        error: mensaje,
      });

    if (!limite.permitido(llave) || !limiteIp.permitido(ip)) {
      return responder('Demasiados intentos. Espera unos minutos antes de volver a probar.', 429);
    }
    const cliente = codigo
      ? await Client.findOne({ clientCode: codigo, portalEnabled: true, status: { $ne: 'retired' } }).select('+portalPasswordHash')
      : null;
    if (!cliente || !verifyPassword(clave, cliente.portalPasswordHash)) {
      limite.anotar(llave, false);
      limiteIp.anotar(ip, false);
      return responder('El código de cliente o la clave no son correctos.');
    }
    limite.anotar(llave, true);
    limiteIp.anotar(ip, true);
    cliente.portalLastLoginAt = new Date();
    await cliente.save();
    const idCliente = String(cliente._id);
    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.clienteId = idCliente;
      return res.redirect('/portal');
    });
  } catch (error) {
    return next(error);
  }
}

function logout(req, res) {
  if (req.session) req.session.clienteId = null;
  return res.redirect('/portal/login');
}

/** POST /portal/preferencia-tema — guarda el tema elegido por el cliente. */
async function guardarTema(req, res) {
  const tema = String(req.body.tema || '');
  if (!['oscuro', 'claro', 'claro-suave'].includes(tema)) {
    return res.status(422).json({ ok: false, mensaje: 'Tema no válido.' });
  }
  try {
    await Client.updateOne({ _id: req.cliente._id }, { $set: { portalTheme: tema } });
    return res.json({ ok: true, tema });
  } catch (error) {
    return res.status(500).json({ ok: false, mensaje: error.message });
  }
}

async function datosCuenta(clienteId) {
  const [deuda, pendientes, vencidas, pagadas, totalFacturas, proxima, ticketsAbiertos, totalTickets] = await Promise.all([
    Invoice.aggregate([
      { $match: { clientId: new mongoose.Types.ObjectId(String(clienteId)), status: { $in: PENDIENTES } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Invoice.countDocuments({ clientId: clienteId, status: { $in: PENDIENTES } }),
    Invoice.countDocuments({ clientId: clienteId, status: 'overdue' }),
    Invoice.countDocuments({ clientId: clienteId, status: 'paid' }),
    Invoice.countDocuments({ clientId: clienteId }),
    Invoice.findOne({ clientId: clienteId, status: { $in: PENDIENTES } }).sort({ dueDate: 1 }).lean(),
    Ticket.countDocuments({ clientId: clienteId, status: { $in: ['open', 'in_progress'] } }),
    Ticket.countDocuments({ clientId: clienteId }),
  ]);
  return {
    deuda: deuda[0]?.total || 0,
    facturas: { pendientes, vencidas, pagadas, total: totalFacturas },
    proxima,
    tickets: { abiertos: ticketsAbiertos, total: totalTickets },
  };
}

/** GET /portal — resumen de la cuenta. */
async function index(req, res, next) {
  try {
    const cliente = req.cliente;
    const [cuenta, suscripcion, facturas, tickets] = await Promise.all([
      datosCuenta(cliente._id),
      Subscription.findOne({ clientId: cliente._id }).populate('planId').lean(),
      Invoice.find({ clientId: cliente._id }).sort({ issueDate: -1 }).limit(5).lean(),
      Ticket.find({ clientId: cliente._id }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    res.render('portal/index', {
      titulo: 'Resumen',
      layout: 'layouts/portal',
      cuenta,
      suscripcion,
      facturas,
      tickets,
      seccion: 'resumen',
    });
  } catch (error) {
    next(error);
  }
}

/** GET /portal/facturas */
async function facturas(req, res, next) {
  try {
    const estado = ['todas', 'pendientes', 'vencidas', 'pagadas'].includes(req.query.estado) ? req.query.estado : 'todas';
    const filtro = { clientId: req.cliente._id };
    if (estado === 'pendientes') filtro.status = { $in: PENDIENTES };
    else if (estado === 'vencidas') filtro.status = 'overdue';
    else if (estado === 'pagadas') filtro.status = 'paid';

    const total = await Invoice.countDocuments(filtro);
    const paginacion = pagina(req.query.pagina, total);
    const { skip, limit } = rango(paginacion.actual);
    const [lista, cuenta] = await Promise.all([
      Invoice.find(filtro).sort({ issueDate: -1 }).skip(skip).limit(limit).lean(),
      datosCuenta(req.cliente._id),
    ]);
    res.render('portal/invoices', {
      titulo: 'Mis facturas',
      layout: 'layouts/portal',
      facturas: lista,
      paginacion,
      estado,
      cuenta,
      seccion: 'facturas',
    });
  } catch (error) {
    next(error);
  }
}

/** GET /portal/tickets */
async function tickets(req, res, next) {
  try {
    const estado = ['todos', 'abiertos', 'en_proceso', 'resueltos', 'cerrados'].includes(req.query.estado)
      ? req.query.estado
      : 'todos';
    const filtro = { clientId: req.cliente._id };
    if (estado === 'abiertos') filtro.status = { $in: ['open', 'in_progress'] };
    else if (estado === 'en_proceso') filtro.status = 'in_progress';
    else if (estado === 'resueltos') filtro.status = 'resolved';
    else if (estado === 'cerrados') filtro.status = 'closed';

    const total = await Ticket.countDocuments(filtro);
    const paginacion = pagina(req.query.pagina, total);
    const { skip, limit } = rango(paginacion.actual);
    const [lista, cuenta] = await Promise.all([
      Ticket.find(filtro).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      datosCuenta(req.cliente._id),
    ]);
    res.render('portal/tickets', {
      titulo: 'Mis tickets',
      layout: 'layouts/portal',
      tickets: lista,
      paginacion,
      estado,
      cuenta,
      seccion: 'tickets',
    });
  } catch (error) {
    next(error);
  }
}

/** GET /portal/facturas/:id */
async function facturaDetalle(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw crearError(404, 'La factura no existe.');
    const factura = await Invoice.findOne({ _id: req.params.id, clientId: req.cliente._id }).lean();
    if (!factura) throw crearError(404, 'La factura no existe.');
    res.render('portal/invoice', {
      titulo: `Factura ${factura.invoiceNumber}`,
      layout: 'layouts/portal',
      factura,
      seccion: 'facturas',
    });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/portal/facturas');
    }
    next(error);
  }
}

/** GET /portal/tickets/nuevo */
function ticketForm(req, res) {
  res.render('portal/ticket', {
    titulo: 'Nuevo ticket',
    layout: 'layouts/portal',
    valores: { priority: 'medium', category: 'technical' },
    errores: [],
    seccion: 'tickets',
  });
}

/** POST /portal/tickets */
async function crearTicket(req, res, next) {
  try {
    const subject = String(req.body.subject || '').trim();
    const description = String(req.body.description || '').trim();
    const priority = PRIORIDADES.includes(req.body.priority) ? req.body.priority : 'medium';
    const category = CATEGORIAS.includes(req.body.category) ? req.body.category : 'technical';
    const errores = [];
    if (!subject) errores.push('El asunto es obligatorio.');
    else if (subject.length > 120) errores.push('El asunto no puede superar 120 caracteres.');
    if (!description) errores.push('La descripción es obligatoria.');
    else if (description.length < 10) errores.push('Describe el problema con un poco más de detalle.');
    if (errores.length) {
      return res.status(422).render('portal/ticket', {
        titulo: 'Nuevo ticket',
        layout: 'layouts/portal',
        valores: { subject, description, priority, category },
        errores,
        seccion: 'tickets',
      });
    }

    const ticket = await Ticket.create({
      code: await Ticket.siguienteCodigo(),
      clientId: req.cliente._id,
      subject,
      description,
      category,
      priority,
      status: 'open',
      assignedTo: 'Soporte',
    });
    await ticketAlertService.notificarTicketCreado(ticket, req.cliente, 'portal');
    await registrar({
      module: 'support',
      entity: 'Ticket',
      entityId: ticket._id,
      action: 'create',
      description: `Ticket ${ticket.code} creado desde el portal por ${req.cliente.clientCode}.`,
      actor: `portal:${req.cliente.clientCode}`,
    });
    req.flash('exito', `Ticket ${ticket.code} creado. Soporte te contactará por este medio.`);
    res.redirect(`/portal/tickets/${ticket._id}`);
  } catch (error) {
    next(error);
  }
}

/** GET /portal/tickets/:id */
async function ticketDetalle(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw crearError(404, 'El ticket no existe.');
    const ticket = await Ticket.findOne({ _id: req.params.id, clientId: req.cliente._id }).lean();
    if (!ticket) throw crearError(404, 'El ticket no existe.');
    ticket.messages = (ticket.messages || []).filter((mensaje) => !mensaje.internal);
    res.render('portal/ticket-detail', {
      titulo: `Ticket ${ticket.code}`,
      layout: 'layouts/portal',
      ticket,
      seccion: 'tickets',
    });
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/portal/tickets');
    }
    next(error);
  }
}

/** POST /portal/tickets/:id/mensajes — respuesta del cliente. */
async function responderTicket(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw crearError(404, 'El ticket no existe.');
    const ticket = await Ticket.findOne({ _id: req.params.id, clientId: req.cliente._id });
    if (!ticket) throw crearError(404, 'El ticket no existe.');
    if (ticket.status === 'closed') throw crearError(422, 'Este ticket está cerrado. Abre uno nuevo.');
    const body = String(req.body.body || '').trim();
    if (!body) {
      req.flash('error', 'Escribe un mensaje antes de enviarlo.');
      return res.redirect(`/portal/tickets/${ticket._id}#respuesta`);
    }
    ticket.messages.push({
      author: req.cliente.fullName || req.cliente.clientCode,
      body: body.slice(0, 2000),
      internal: false,
    });
    if (ticket.status === 'resolved') ticket.status = 'open';
    await ticket.save();
    await registrar({
      module: 'support',
      entity: 'Ticket',
      entityId: ticket._id,
      action: 'reply',
      description: `Respuesta del cliente ${req.cliente.clientCode} en el ticket ${ticket.code}.`,
      actor: `portal:${req.cliente.clientCode}`,
    });
    req.flash('exito', 'Mensaje enviado a soporte.');
    res.redirect(`/portal/tickets/${ticket._id}#respuesta`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/portal/tickets');
    }
    next(error);
  }
}

module.exports = {
  requiereCliente,
  loginForm,
  login,
  logout,
  guardarTema,
  index,
  facturas,
  tickets,
  ticketForm,
  crearTicket,
  facturaDetalle,
  ticketDetalle,
  responderTicket,
};
