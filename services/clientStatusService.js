const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const Subscription = require('../models/Subscription');
const Settings = require('../models/Settings');
const billingService = require('./billingService');
const firewallService = require('./firewallService');
const { registrar } = require('./auditService');
const { inicioDelDia, sumarDias } = require('../utils/dates');

const PENDIENTES = ['overdue'];

/**
 * Sincroniza el estado del cliente con su deuda vencida real:
 * solo facturas de servicio que superaron los días de gracia.
 * Los cortes manuales (statusReason 'manual') no se reactivan aquí.
 */
async function verificarEstados({ actor = 'system' } = {}) {
  const settings = await Settings.getSingleton();
  await billingService.marcarVencidas();
  const corteDesde = inicioDelDia(sumarDias(new Date(), -settings.billing.graceDays));
  const clientes = await Client.find({ status: { $ne: 'retired' } })
    .select('status statusReason clientCode')
    .lean();

  const vencidas = await Invoice.aggregate([
    {
      $match: {
        status: { $in: PENDIENTES },
        type: 'service',
        affectsService: true,
        dueDate: { $lt: corteDesde },
      },
    },
    { $group: { _id: '$clientId', total: { $sum: '$total' } } },
  ]);
  const conDeuda = new Set(vencidas.filter((fila) => fila.total > 0).map((fila) => String(fila._id)));

  const suspender = [];
  const reactivar = [];

  for (const cliente of clientes) {
    const debe = conDeuda.has(String(cliente._id));
    if (debe && cliente.status === 'active') suspender.push(cliente._id);
    else if (!debe && cliente.status === 'suspended' && cliente.statusReason !== 'manual') reactivar.push(cliente._id);
  }

  if (suspender.length) {
    await Client.updateMany(
      { _id: { $in: suspender } },
      { $set: { status: 'suspended', statusReason: 'billing' } }
    );
  }
  if (reactivar.length) {
    await Client.updateMany(
      { _id: { $in: reactivar } },
      { $set: { status: 'active', statusReason: '' } }
    );
    /* Sin deuda se restablece el servicio y el período arranca de nuevo. */
    const suscripciones = await Subscription.find({ clientId: { $in: reactivar } });
    for (const subscription of suscripciones) {
      try {
        if (subscription.status === 'suspended' || subscription.firewallState !== 'none') {
          await firewallService.desbloquear(subscription, {
            reason: 'Verificación de facturación: sin deuda vencida.',
            actor,
            estadoAnterior: { status: subscription.status, firewallState: subscription.firewallState },
          });
        }
        const actual = await Subscription.findById(subscription._id);
        if (actual) {
          if (actual.status !== 'active') actual.status = 'active';
          if (billingService.reanudarPeriodo(actual)) await actual.save();
        }
      } catch (error) {
        console.error('No se pudo reactivar el servicio del cliente:', error.message);
      }
    }
  }

  if (suspender.length || reactivar.length) {
    await registrar({
      module: 'financial',
      entity: 'Client',
      action: 'update',
      description: `Verificación de facturación: ${suspender.length} suspendido(s) y ${reactivar.length} reactivado(s).`,
      changes: { after: { suspendidos: suspender.length, reactivados: reactivar.length } },
      actor,
    });
  }

  return {
    revisados: clientes.length,
    suspendidos: suspender.length,
    reactivados: reactivar.length,
  };
}

module.exports = { verificarEstados };
