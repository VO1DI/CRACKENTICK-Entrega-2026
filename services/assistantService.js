const Client = require('../models/Client');
const Ticket = require('../models/Ticket');
const FaultReport = require('../models/FaultReport');
const InstallationReport = require('../models/InstallationReport');
const Router = require('../models/Router');
const aiService = require('./aiService');
const capacityService = require('./capacityService');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');
const { escaparRegex } = require('../utils/strings');
const { fechaLocal, inicioDelDia, finDelDia } = require('../utils/dates');
const { PRIORIDADES_TICKET } = require('../config/constants');
const { puedeVer, puedeEditar } = require('../utils/permissions');

function puede(usuario, clave) {
  return puedeEditar(usuario, clave);
}

function exigir(usuario, clave) {
  if (!puede(usuario, clave)) throw crearError(403, 'No tienes permiso para consultar esa información.');
}

/** Consultar no exige edición: basta con permiso de lectura en el nodo. */
function exigirVer(usuario, clave) {
  if (!puedeVer(usuario, clave)) throw crearError(403, 'No tienes permiso para consultar esa información.');
}

function hoyISO() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

const HERRAMIENTAS = [
  {
    type: 'function',
    function: {
      name: 'buscar_clientes',
      description: 'Busca clientes por nombre, apellido o código. Devuelve hasta 5 coincidencias.',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string', description: 'Nombre, apellido o código del cliente.' } },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_tickets',
      description: 'Busca tickets por código, asunto o cliente. Devuelve hasta 5.',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string', description: 'Código, asunto o nombre del cliente.' } },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_red',
      description: 'Resume routers, capacidad contratada, Mbps vendidos y disponible.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'averias_dia',
      description: 'Lista las averías de un día (por defecto hoy) con su identificador y estado.',
      parameters: {
        type: 'object',
        properties: { fecha: { type: 'string', description: 'Fecha YYYY-MM-DD. Opcional.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'instalaciones_dia',
      description: 'Lista las instalaciones de un día (por defecto hoy).',
      parameters: {
        type: 'object',
        properties: { fecha: { type: 'string', description: 'Fecha YYYY-MM-DD. Opcional.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_web',
      description: 'Busca información general y actual en Internet. Úsala solo para dudas externas, no para datos internos.',
      parameters: {
        type: 'object',
        properties: { consulta: { type: 'string', description: 'Consulta breve.' } },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proponer_ticket',
      description: 'Prepara la creación de un ticket. No lo crea: el usuario debe confirmar en pantalla.',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Código o nombre exacto del cliente.' },
          asunto: { type: 'string' },
          descripcion: { type: 'string' },
          prioridad: { type: 'string', enum: PRIORIDADES_TICKET },
        },
        required: ['cliente', 'asunto', 'descripcion'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proponer_solventar_averia',
      description: 'Prepara marcar una avería como solventada. No la modifica: el usuario debe confirmar.',
      parameters: {
        type: 'object',
        properties: {
          reporte_id: { type: 'string', description: 'Identificador de la avería obtenido con averias_dia.' },
          nota: { type: 'string', description: 'Nota opcional de resolución.' },
        },
        required: ['reporte_id'],
      },
    },
  },
];

async function buscarClientes(usuario, texto) {
  exigirVer(usuario, 'general.clientes');
  const regex = new RegExp(escaparRegex(String(texto || '').trim()), 'i');
  const clientes = await Client.find({ $or: [{ firstName: regex }, { lastName: regex }, { clientCode: regex }] })
    .limit(5)
    .lean();
  return clientes.map((c) => ({
    id: String(c._id),
    codigo: c.clientCode,
    nombre: `${c.firstName} ${c.lastName}`.trim(),
    estado: c.status,
    telefono: c.phone || '',
  }));
}

async function buscarTickets(usuario, texto) {
  exigirVer(usuario, 'soporte.tickets');
  const regex = new RegExp(escaparRegex(String(texto || '').trim()), 'i');
  const clientes = await Client.find({ $or: [{ firstName: regex }, { lastName: regex }] }).select('_id').lean();
  const tickets = await Ticket.find({
    $or: [{ code: regex }, { subject: regex }, { description: regex }, { clientId: { $in: clientes.map((c) => c._id) } }],
  })
    .populate('clientId')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  return tickets.map((t) => ({
    id: String(t._id),
    codigo: t.code,
    asunto: t.subject,
    cliente: t.clientId ? `${t.clientId.firstName} ${t.clientId.lastName}`.trim() : '',
    estado: t.status,
    prioridad: t.priority,
  }));
}

async function resumenRed(usuario) {
  exigirVer(usuario, 'red.routers');
  const routers = await Router.find({ active: true }).sort({ name: 1 }).lean();
  const capacidad = await capacityService.resumenPorRouter('activos');
  return routers.map((router) => {
    const cap = capacidad(router);
    return {
      router: router.name,
      modo: router.planMode,
      contratado: `${cap.contractedDownload}/${cap.contractedUpload} Mbps`,
      vendido: `${cap.download}/${cap.upload} Mbps`,
      disponible: `${cap.availableDownload}/${cap.availableUpload} Mbps`,
      servicios: cap.servicios,
    };
  });
}

async function averiasDia(usuario, fecha) {
  exigirVer(usuario, 'red.averias');
  const dia = fechaLocal(/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : hoyISO());
  const reportes = await FaultReport.find({ faultDate: { $gte: inicioDelDia(dia), $lte: finDelDia(dia) } })
    .populate('zoneId')
    .populate('clientId')
    .sort({ reportedAt: 1 })
    .limit(40)
    .lean();
  return reportes.map((r) => ({
    id: String(r._id),
    zona: r.zoneId?.name || 'Sin zona',
    cliente: r.clientId ? `${r.clientId.firstName} ${r.clientId.lastName}`.trim() : r.clientName,
    problema: r.problem,
    estado: r.status,
    tecnico: r.technician,
    ticket: r.ticketId ? String(r.ticketId) : null,
  }));
}

async function instalacionesDia(usuario, fecha) {
  exigirVer(usuario, 'red.instalaciones');
  const dia = fechaLocal(/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : hoyISO());
  const reportes = await InstallationReport.find({ installedAt: { $gte: inicioDelDia(dia), $lte: finDelDia(dia) } })
    .populate('zoneId')
    .populate('saleId')
    .limit(40)
    .lean();
  return reportes.map((r) => ({
    id: String(r._id),
    zona: r.zoneId?.name || 'Sin zona',
    cliente: r.clientName,
    plan: r.planName,
    venta: r.saleId?.code || '',
    tecnico: r.technician,
  }));
}

async function proponerTicket(usuario, args = {}) {
  exigir(usuario, 'soporte.tickets');
  exigir(usuario, 'general.clientes');
  const texto = String(args.cliente || '').trim();
  const patron = new RegExp(escaparRegex(texto), 'i');
  const candidatos = await Client.find({ $or: [{ clientCode: patron }, { firstName: patron }, { lastName: patron }] }).limit(2);
  if (candidatos.length > 1) return { pendiente: null, mensaje: 'Hay más de un cliente con ese nombre. Indica el código exacto.' };
  const [cliente] = candidatos;
  if (!cliente) return { pendiente: null, mensaje: 'No encontré ese cliente. Indica el código exacto.' };

  const asunto = String(args.asunto || '').trim().slice(0, 120);
  const descripcion = String(args.descripcion || '').trim().slice(0, 2000);
  if (!asunto || !descripcion) return { pendiente: null, mensaje: 'Faltan el asunto o la descripción del ticket.' };

  return {
    pendiente: {
      tipo: 'ticket',
      resumen: `Crear ticket para ${cliente.firstName} ${cliente.lastName} (${cliente.clientCode}): ${asunto}`,
      datos: {
        clientId: String(cliente._id),
        subject: asunto,
        description: descripcion,
        priority: PRIORIDADES_TICKET.includes(args.prioridad) ? args.prioridad : 'medium',
      },
    },
    mensaje: `Preparé el ticket para ${cliente.firstName} ${cliente.lastName}: “${asunto}”. Confírmalo abajo para crearlo.`,
  };
}

async function proponerSolventar(usuario, args = {}) {
  exigir(usuario, 'red.averias');
  if (!args.reporte_id) return { pendiente: null, mensaje: 'Falta el identificador de la avería.' };
  const reporte = await FaultReport.findById(String(args.reporte_id)).populate('clientId');
  if (!reporte) return { pendiente: null, mensaje: 'No encontré esa avería.' };
  if (reporte.status === 'solved') return { pendiente: null, mensaje: 'Esa avería ya está solventada.' };
  return {
    pendiente: {
      tipo: 'averia',
      resumen: `Marcar como solventada la avería de ${reporte.clientName || reporte.clientId?.firstName || 'cliente'}: ${reporte.problem.slice(0, 80)}`,
      datos: { reporteId: String(reporte._id), nota: String(args.nota || '').slice(0, 300) },
    },
    mensaje: 'Preparé el cierre de la avería. Confírmalo abajo para marcarla como solventada y dejar la nota en el ticket.',
  };
}

async function ejecutarHerramienta(nombre, args, usuario, settings) {
  switch (nombre) {
    case 'buscar_clientes':
      return buscarClientes(usuario, args.texto);
    case 'buscar_tickets':
      return buscarTickets(usuario, args.texto);
    case 'resumen_red':
      return resumenRed(usuario);
    case 'averias_dia':
      return averiasDia(usuario, args.fecha);
    case 'instalaciones_dia':
      return instalacionesDia(usuario, args.fecha);
    case 'buscar_web':
      return aiService.buscarWeb(settings, args.consulta);
    default:
      throw crearError(400, `Herramienta desconocida: ${nombre}`);
  }
}

/** Ejecuta el turno del asistente y devuelve texto + posible acción pendiente. */
async function responder({ usuario, settings, historial = [], mensaje }) {
  if (!settings?.ai?.enabled) throw crearError(503, 'El asistente está desactivado en Configuración.');
  if (!settings.ai.apiKeyEnc) throw crearError(503, 'Falta la clave de la API de IA en Configuración.');

  const sistema = [
    'Eres el asistente de CRACKENTICK, un sistema de gestión de ISP.',
    'Responde en español, de forma breve y concreta.',
    'Usa las herramientas para consultar datos reales; no inventes cifras ni clientes.',
    'No tienes acceso directo a MongoDB ni a RouterOS: todo pasa por las herramientas.',
    'Nunca ejecutes cambios por tu cuenta. Para crear un ticket o solventar una avería usa proponer_* y pide confirmación.',
    `Fecha actual: ${hoyISO()}.`,
  ].join(' ');

  const mensajes = [{ role: 'system', content: sistema }];
  (Array.isArray(historial) ? historial : []).slice(-10).forEach((turno) => {
    if (!turno || !['user', 'assistant'].includes(turno.role)) return;
    const contenido = String(turno.content || '').slice(0, 3000);
    if (contenido) mensajes.push({ role: turno.role, content: contenido });
  });
  mensajes.push({ role: 'user', content: String(mensaje || '').slice(0, 3000) });

  for (let intento = 0; intento < 4; intento += 1) {
    const respuesta = await aiService.chat(settings, { messages: mensajes, tools: HERRAMIENTAS });
    if (!respuesta.tool_calls?.length) {
      return { mensaje: respuesta.content || 'No pude generar una respuesta.', pendiente: null, modelo: settings.ai.model };
    }

    const propuesta = respuesta.tool_calls.find((llamada) => ['proponer_ticket', 'proponer_solventar_averia'].includes(llamada.function?.name));
    if (propuesta) {
      const args = JSON.parse(propuesta.function.arguments || '{}');
      const resultado =
        propuesta.function.name === 'proponer_ticket'
          ? await proponerTicket(usuario, args)
          : await proponerSolventar(usuario, args);
      return { ...resultado, modelo: settings.ai.model };
    }

    mensajes.push({ role: 'assistant', content: respuesta.content || '', tool_calls: respuesta.tool_calls });
    for (const llamada of respuesta.tool_calls) {
      let resultado;
      try {
        const args = JSON.parse(llamada.function.arguments || '{}');
        resultado = await ejecutarHerramienta(llamada.function.name, args, usuario, settings);
      } catch (error) {
        resultado = { error: error.message };
      }
      mensajes.push({ role: 'tool', tool_call_id: llamada.id, content: JSON.stringify(resultado).slice(0, 6000) });
    }
  }
  return { mensaje: 'No pude completar la consulta con las herramientas disponibles.', pendiente: null, modelo: settings.ai.model };
}

/** Aplica una acción propuesta, solo tras la confirmación explícita del usuario. */
async function aplicarPendiente(pendiente, usuario) {
  if (!pendiente || !pendiente.tipo) throw crearError(422, 'No hay una acción pendiente.');

  if (pendiente.tipo === 'ticket') {
    exigir(usuario, 'soporte.tickets');
    exigir(usuario, 'general.clientes');
    const cliente = await Client.findById(pendiente.datos.clientId);
    if (!cliente) throw crearError(404, 'El cliente ya no existe.');
    const ticket = await Ticket.create({
      code: await Ticket.siguienteCodigo(),
      clientId: cliente._id,
      subject: pendiente.datos.subject,
      description: pendiente.datos.description,
      category: 'technical',
      priority: pendiente.datos.priority || 'medium',
      status: 'open',
      assignedTo: usuario?.name || 'Soporte',
    });
    await registrar({
      module: 'support',
      entity: 'Ticket',
      entityId: ticket._id,
      action: 'create',
      description: `Ticket ${ticket.code} creado con el asistente para ${cliente.clientCode}: ${ticket.subject}.`,
      aiAssisted: true,
      aiModel: pendiente.modelo || '',
      confirmed: true,
      confirmedBy: usuario?.username || 'usuario',
    });
    return { mensaje: `Ticket ${ticket.code} creado para ${cliente.firstName} ${cliente.lastName}.`, enlace: `/soporte/tickets/${ticket._id}` };
  }

  if (pendiente.tipo === 'averia') {
    exigir(usuario, 'red.averias');
    const reporte = await FaultReport.findById(pendiente.datos.reporteId);
    if (!reporte) throw crearError(404, 'La avería ya no existe.');
    reporte.status = 'solved';
    reporte.resolvedAt = new Date();
    if (pendiente.datos.nota) {
      reporte.note = `${reporte.note ? `${reporte.note} ` : ''}${pendiente.datos.nota}`.slice(0, 500);
    }
    await reporte.save();

    if (reporte.ticketId) {
      const ticket = await Ticket.findById(reporte.ticketId);
      if (ticket) {
        ticket.messages.push({
          author: 'Asistente IA',
          body: `Avería solventada: ${reporte.problem.slice(0, 160)}${pendiente.datos.nota ? `. Nota: ${pendiente.datos.nota}` : ''}`.slice(0, 2000),
          internal: true,
        });
        if (ticket.status === 'open') ticket.status = 'in_progress';
        await ticket.save();
      }
    }

    await registrar({
      module: 'technical',
      entity: 'FaultReport',
      entityId: reporte._id,
      action: 'update',
      description: `Avería marcada como solventada con el asistente: ${reporte.problem.slice(0, 80)}.`,
      aiAssisted: true,
      aiModel: pendiente.modelo || '',
      confirmed: true,
      confirmedBy: usuario?.username || 'usuario',
      changes: { after: { status: 'solved' } },
    });
    return { mensaje: 'Avería marcada como solventada.', enlace: '/red/reportes/averias' };
  }

  throw crearError(422, 'La acción pendiente no es válida.');
}

module.exports = { responder, aplicarPendiente, HERRAMIENTAS };
