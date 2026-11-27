const Ticket = require('../models/Ticket');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const { registrar } = require('../services/auditService');
const staffService = require('../services/staffService');
const ticketAlertService = require('../services/ticketAlertService');
const { crearError, mensajeDeError } = require('../utils/errors');
const {
  TICKETS_POR_PAGINA,
  ESTADOS_TICKET,
  PRIORIDADES_TICKET,
  CATEGORIAS_TICKET,
} = require('../config/constants');
const { escaparRegex } = require('../utils/strings');

/** GET /tickets */
async function index(req, res, next) {
  try {
    const { q = '', estado = '', prioridad = '', categoria = '', page = 1 } = req.query;
    const consulta = {};
    if (ESTADOS_TICKET.includes(estado)) consulta.status = estado;
    if (PRIORIDADES_TICKET.includes(prioridad)) consulta.priority = prioridad;
    if (CATEGORIAS_TICKET.includes(categoria)) consulta.category = categoria;

    if (q.trim()) {
      const regex = new RegExp(escaparRegex(q.trim()), 'i');
      const clientes = await Client.find({ $or: [{ firstName: regex }, { lastName: regex }, { clientCode: regex }] }).select('_id').lean();
      consulta.$or = [{ code: regex }, { subject: regex }, { description: regex }, { clientId: { $in: clientes.map((c) => c._id) } }];
    }

    const total = await Ticket.countDocuments(consulta);
    const paginas = Math.max(1, Math.ceil(total / TICKETS_POR_PAGINA));
    const actual = Math.min(Math.max(1, Number(page) || 1), paginas);

    const [tickets, resumen] = await Promise.all([
      Ticket.find(consulta)
        .populate('clientId')
        .sort({ status: 1, priority: -1, createdAt: -1 })
        .skip((actual - 1) * TICKETS_POR_PAGINA)
        .limit(TICKETS_POR_PAGINA),
      Promise.all([
        Ticket.countDocuments(),
        Ticket.countDocuments({ status: 'open' }),
        Ticket.countDocuments({ status: 'in_progress' }),
        Ticket.countDocuments({ status: 'resolved' }),
        Ticket.countDocuments({ priority: { $in: ['high', 'urgent'] }, status: { $in: ['open', 'in_progress'] } }),
      ]),
    ]);

    res.render('tickets/index', {
      titulo: 'Soporte',
      tickets,
      paginacion: { actual, paginas, total },
      filtros: { q, estado, prioridad, categoria },
      resumen: {
        total: resumen[0],
        abiertos: resumen[1],
        enProceso: resumen[2],
        resueltos: resumen[3],
        criticos: resumen[4],
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /tickets/nuevo */
async function formNuevo(req, res, next) {
  try {
    const [clientes, subscriptions, usuarios] = await Promise.all([
      Client.find().sort({ firstName: 1 }).lean(),
      Subscription.find().populate('clientId').lean(),
      User.find({ active: true }).select('name username').sort({ name: 1 }).lean(),
    ]);
    res.render('tickets/form', {
      titulo: 'Nuevo ticket',
      ticket: new Ticket({ category: 'technical', priority: 'medium', status: 'open' }),
      clientes,
      subscriptions,
      usuarios,
      clienteSeleccionado: req.query.cliente || '',
      modo: 'crear',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** POST /tickets */
async function crear(req, res, next) {
  try {
    const cliente = await Client.findById(req.body.clientId);
    if (!cliente) throw crearError(422, 'Selecciona un cliente válido.');

    const ticket = new Ticket({
      code: await Ticket.siguienteCodigo(),
      clientId: cliente._id,
      subscriptionId: req.body.subscriptionId || null,
      subject: req.body.subject || '',
      description: req.body.description || '',
      category: CATEGORIAS_TICKET.includes(req.body.category) ? req.body.category : 'technical',
      priority: PRIORIDADES_TICKET.includes(req.body.priority) ? req.body.priority : 'medium',
      status: 'open',
      assignedTo: req.body.assignedTo || 'Soporte',
      assigneeId: await staffService.usuarioPorNombre(req.body.assignedTo || 'Soporte'),
      messages: req.body.mensajeInicial
        ? [{ author: 'Soporte', body: req.body.mensajeInicial, internal: false }]
        : [],
    });
    await ticket.save();
    await ticketAlertService.notificarTicketCreado(ticket, cliente, 'soporte');

    await registrar({
      module: 'support',
      entity: 'Ticket',
      entityId: ticket._id,
      action: 'create',
      description: `Ticket ${ticket.code} abierto para ${cliente.clientCode}: ${ticket.subject}.`,
      changes: { after: { code: ticket.code, priority: ticket.priority } },
    });

    req.flash('exito', `Ticket ${ticket.code} creado.`);
    res.redirect(`/tickets/${ticket._id}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const [clientes, subscriptions, usuarios] = await Promise.all([
        Client.find().sort({ firstName: 1 }).lean(),
        Subscription.find().populate('clientId').lean(),
        User.find({ active: true }).select('name username').sort({ name: 1 }).lean(),
      ]);
      return res.status(error.status || 422).render('tickets/form', {
        titulo: 'Nuevo ticket',
        ticket: new Ticket(req.body),
        clientes,
        subscriptions,
        usuarios,
        clienteSeleccionado: req.body.clientId || '',
        modo: 'crear',
        errores: error.name === 'ValidationError' ? Object.values(error.errors).map((d) => d.message) : [mensajeDeError(error)],
      });
    }
    next(error);
  }
}

/** GET /tickets/:id */
async function show(req, res, next) {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('clientId')
      .populate({ path: 'subscriptionId', populate: { path: 'planId' } });
    if (!ticket) throw crearError(404, 'El ticket no existe.');

    const logs = await (require('../models/AuditLog'))
      .find({ entityId: String(ticket._id) })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();

    res.render('tickets/show', {
      titulo: `${ticket.code} · ${ticket.subject}`,
      ticket,
      logs,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /tickets/:id/mensajes */
async function responder(req, res, next) {
  try {
    const ticket = await Ticket.findById(req.params.id).populate('clientId');
    if (!ticket) throw crearError(404, 'El ticket no existe.');
    const body = String(req.body.body || '').trim();
    if (!body) {
      req.flash('error', 'El mensaje no puede estar vacío.');
      return res.redirect(`/tickets/${ticket._id}`);
    }

    ticket.messages.push({
      author: String(req.body.author || (req.body.origen === 'cliente' ? ticket.clientId?.fullName : 'Soporte')).slice(0, 80),
      body: body.slice(0, 2000),
      internal: req.body.internal === 'on',
    });
    if (ticket.status === 'open' && req.body.origen !== 'cliente') ticket.status = 'in_progress';
    await ticket.save();

    await registrar({
      module: 'support',
      entity: 'Ticket',
      entityId: ticket._id,
      action: 'reply',
      description: `Respuesta registrada en el ticket ${ticket.code}.`,
      changes: { after: { autor: ticket.messages[ticket.messages.length - 1].author, status: ticket.status } },
    });

    req.flash('exito', 'Mensaje agregado al ticket.');
    res.redirect(`/tickets/${ticket._id}`);
  } catch (error) {
    next(error);
  }
}

/** POST /tickets/:id/estado */
async function cambiarEstado(req, res, next) {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) throw crearError(404, 'El ticket no existe.');
    const estado = req.body.status;
    if (!ESTADOS_TICKET.includes(estado)) throw crearError(422, 'Estado de ticket no válido.');

    const anterior = ticket.status;
    ticket.status = estado;
    /* Reabrir borra las marcas: las métricas cuentan tickets con resolvedAt. */
    if (estado === 'open' || estado === 'in_progress') {
      ticket.resolvedAt = undefined;
      ticket.closedAt = undefined;
    } else if (estado === 'resolved') {
      ticket.resolvedAt = new Date();
      ticket.closedAt = undefined;
    } else if (estado === 'closed') {
      ticket.closedAt = new Date();
      if (!ticket.resolvedAt) ticket.resolvedAt = new Date();
    }
    await ticket.save();
    if (estado === 'resolved' || estado === 'closed') {
      await ticketAlertService.resolverTicket(ticket._id);
    }

    await registrar({
      module: 'support',
      entity: 'Ticket',
      entityId: ticket._id,
      action: 'update',
      description: `Ticket ${ticket.code}: ${anterior} → ${estado}.`,
      changes: { before: { status: anterior }, after: { status: estado } },
    });

    req.flash('exito', `Ticket ${ticket.code} marcado como ${ticket.status}.`);
    res.redirect(`/tickets/${ticket._id}`);
  } catch (error) {
    next(error);
  }
}

/** POST /tickets/:id/prioridad */
async function cambiarPrioridad(req, res, next) {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) throw crearError(404, 'El ticket no existe.');
    if (!PRIORIDADES_TICKET.includes(req.body.priority)) throw crearError(422, 'Prioridad no válida.');
    const anterior = ticket.priority;
    ticket.priority = req.body.priority;
    await ticket.save();
    await registrar({
      module: 'support',
      entity: 'Ticket',
      entityId: ticket._id,
      action: 'update',
      description: `Ticket ${ticket.code}: prioridad ${anterior} → ${ticket.priority}.`,
      changes: { before: { priority: anterior }, after: { priority: ticket.priority } },
    });
    req.flash('exito', 'Prioridad actualizada.');
    res.redirect(`/tickets/${ticket._id}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { index, formNuevo, crear, show, responder, cambiarEstado, cambiarPrioridad };
