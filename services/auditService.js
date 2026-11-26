const AuditLog = require('../models/AuditLog');
const { sanearSecretos } = require('../utils/strings');
const { actorActual, iaActual } = require('../utils/context');

/**
 * Registra un evento de auditoría. Nunca lanza: un fallo de auditoría
 * no debe tumbar la operación principal, pero sí deja rastro en consola.
 */
async function registrar(evento = {}) {
  try {
    const ia = iaActual() || {};
    const actor = String(actorActual() || evento.actor || 'system').slice(0, 60);
    const aiModel = String(evento.aiModel || ia.model || '').slice(0, 80);
    const aiAssisted = Boolean(evento.aiAssisted || ia.model);
    return await AuditLog.create({
      timestamp: new Date(),
      module: evento.module || 'settings',
      entity: evento.entity || '',
      entityId: evento.entityId ? String(evento.entityId) : '',
      action: evento.action || 'update',
      description: evento.description || 'Cambio registrado',
      changes: evento.changes ? sanearSecretos(evento.changes) : undefined,
      command: evento.command || '',
      commandResult: evento.commandResult || '',
      status: evento.status === 'failed' ? 'failed' : 'success',
      durationMs: Number.isFinite(evento.durationMs) ? evento.durationMs : undefined,
      actor,
      aiModel,
      aiAssisted,
      confirmed: evento.confirmed !== false,
      confirmedBy: evento.confirmed === false ? '' : String(evento.confirmedBy || actor).slice(0, 60),
      confirmedAt: evento.confirmed === false ? undefined : new Date(),
    });
  } catch (error) {
    console.error('⚠️  No se pudo registrar la auditoría:', error.message);
    return null;
  }
}

module.exports = { registrar };
