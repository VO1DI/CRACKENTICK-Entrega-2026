const Alert = require('../models/Alert');
const alertBadgeCache = require('./alertBadgeCache');

const SEVERIDAD_POR_PRIORIDAD = { urgent: 'critical', high: 'warning' };

/** Avisa al equipo cuando entra un ticket nuevo, desde el panel o desde el portal. */
async function notificarTicketCreado(ticket, cliente, origen = 'soporte') {
  try {
    const etiquetaOrigen = origen === 'portal' ? 'Portal' : 'Soporte';
    const alerta = await Alert.create({
      type: 'ticket_new',
      severity: SEVERIDAD_POR_PRIORIDAD[ticket.priority] || 'info',
      message: `Ticket ${ticket.code}: ${ticket.subject}`,
      value: [cliente && cliente.clientCode, etiquetaOrigen].filter(Boolean).join(' · '),
      ticketId: ticket._id,
      link: `/soporte/tickets/${ticket._id}`,
    });
    alertBadgeCache.invalidar();
    return alerta;
  } catch (error) {
    /* El ticket ya quedó guardado: el aviso es auxiliar y no debe tumbar el alta. */
    console.warn('No se pudo crear la alerta del ticket:', error.message);
    return null;
  }
}

/** Cierra el aviso del ticket cuando el ticket se resuelve o se cierra. */
async function resolverTicket(ticketId) {
  try {
    const resultado = await Alert.updateMany(
      { type: 'ticket_new', ticketId, status: { $ne: 'resolved' } },
      { $set: { status: 'resolved', resolvedAt: new Date() } }
    );
    if (resultado.modifiedCount) alertBadgeCache.invalidar();
    return resultado.modifiedCount;
  } catch (error) {
    console.warn('No se pudo resolver la alerta del ticket:', error.message);
    return 0;
  }
}

module.exports = { notificarTicketCreado, resolverTicket };
