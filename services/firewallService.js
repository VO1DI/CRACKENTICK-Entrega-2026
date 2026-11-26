const Settings = require('../models/Settings');
const Subscription = require('../models/Subscription');
const Client = require('../models/Client');
const Router = require('../models/Router');
const { crearDriver, construirComando } = require('./firewall/drivers');
const auditService = require('./auditService');
const { registrar } = require('./auditService');
const { crearError } = require('../utils/errors');

async function configuracion() {
  return Settings.getSingleton();
}

async function prepararSubscription(subscription) {
  if (subscription.clientId && typeof subscription.clientId === 'object' && subscription.clientId.clientCode) {
    return subscription;
  }
  return Subscription.findById(subscription._id).populate('clientId').populate('planId');
}

/**
 * Ejecuta una acción de firewall sobre una suscripción, actualiza su estado
 * y registra el comando y el resultado en la auditoría.
 */
async function ejecutar(accion, subscription, contexto = {}) {
  const settings = await configuracion();
  const completa = await prepararSubscription(subscription);
  if (!completa.serviceConfig?.routerId) {
    const activos = await Router.countDocuments({ active: true });
    if (activos > 1) {
      throw crearError(422, 'El servicio no tiene un router asignado. Asígnalo antes de cortar o restaurar para no afectar otro equipo.');
    }
  }
  const router = completa.serviceConfig?.routerId
    ? await Router.findById(completa.serviceConfig.routerId).select('+passwordEnc')
    : null;
  const resultado = await ejecutarDriver(accion, completa, settings, router);
  const ahora = new Date();

  if (resultado.ok) {
    if (accion === 'block') {
      completa.status = 'suspended';
      completa.firewallState = 'blocked';
      completa.firewallBlockedAt = ahora;
      completa.lastStatusChangeAt = ahora;
      if (resultado.fallbackPppoe) completa.pppoeDisabled = true;
      await completa.save();
      await Client.updateOne(
        { _id: completa.clientId._id || completa.clientId },
        { $set: { status: 'suspended', statusReason: contexto.motivo === 'billing' ? 'billing' : 'manual' } }
      );
    } else if (accion === 'unblock') {
      completa.status = 'active';
      completa.firewallState = 'none';
      completa.firewallBlockedAt = undefined;
      completa.pppoeDisabled = false;
      completa.lastStatusChangeAt = ahora;
      await completa.save();
      await Client.updateOne(
        { _id: completa.clientId._id || completa.clientId },
        { $set: { status: 'active', statusReason: '' } }
      );
    } else if (accion === 'pppoe-disable') {
      completa.pppoeDisabled = true;
      completa.lastStatusChangeAt = ahora;
      await completa.save();
    } else if (accion === 'pppoe-enable') {
      completa.pppoeDisabled = false;
      completa.lastStatusChangeAt = ahora;
      await completa.save();
    }
  } else {
    if (accion === 'block' || accion === 'unblock') {
      completa.firewallState = 'error';
      if (accion === 'unblock') {
        // Según la regla 7.7: el servicio queda activo con error visible para reintentar.
        completa.status = 'active';
        completa.lastStatusChangeAt = ahora;
      }
    }
    await completa.save();
  }

  const etiquetaAccion = {
    block: 'Corte',
    unblock: 'Restauración',
    'pppoe-disable': 'Desactivación de PPPoE',
    'pppoe-enable': 'Activación de PPPoE',
  }[accion] || 'Acción de firewall';

  await registrar({
    module: 'firewall',
    entity: 'Subscription',
    entityId: completa._id,
    action: accion.replace(/-/g, '_'),
    description: `${etiquetaAccion} de ${completa.clientId?.clientCode || 'cliente'}${contexto.reason ? `: ${contexto.reason}` : ''}`,
    changes: {
      before: {
        status: contexto.estadoAnterior?.status || null,
        firewallState: contexto.estadoAnterior?.firewallState || null,
        pppoeDisabled: contexto.estadoAnterior?.pppoeDisabled ?? null,
      },
      after: { status: completa.status, firewallState: completa.firewallState, pppoeDisabled: completa.pppoeDisabled },
    },
    command: resultado.command,
    commandResult: resultado.result,
    status: resultado.ok ? 'success' : 'failed',
    durationMs: resultado.durationMs,
    actor: contexto.actor || 'admin',
  });

  return { ...resultado, subscription: completa };
}

async function ejecutarDriver(accion, subscription, settings, router = null) {
  let driver;
  try {
    driver = crearDriver(settings, router);
  } catch (error) {
    return { ok: false, command: '', result: error.message, durationMs: 0, simulated: (router?.mode || settings.firewall.mode) === 'simulated' };
  }

  try {
    if (accion === 'block') return await driver.block(subscription);
    if (accion === 'unblock') return await driver.unblock(subscription);
    if (accion === 'pppoe-disable') return await driver.pppoeDisable(subscription);
    if (accion === 'pppoe-enable') return await driver.pppoeEnable(subscription);
    return await driver.testConnection();
  } catch (error) {
    return {
      ok: false,
      command: construirComando(accion, subscription).comando,
      result: error.message || 'El router rechazó la operación.',
      simulated: settings.firewall.mode === 'simulated',
      durationMs: 0,
    };
  }
}

async function bloquear(subscription, contexto = {}) {
  if (subscription.firewallState === 'blocked' && subscription.status === 'suspended') {
    return {
      ok: true,
      omitted: true,
      command: '',
      result: 'El corte ya estaba aplicado.',
      durationMs: 0,
      subscription,
    };
  }
  return ejecutar('block', subscription, contexto);
}

async function desbloquear(subscription, contexto = {}) {
  if (subscription.firewallState === 'none' && subscription.status === 'active' && !subscription.pppoeDisabled) {
    return {
      ok: true,
      omitted: true,
      command: '',
      result: 'El servicio ya estaba activo.',
      durationMs: 0,
      subscription,
    };
  }
  return ejecutar('unblock', subscription, contexto);
}

/** Desactiva el secret PPPoE sin tocar la lista MOROSOS. */
async function desactivarPppoe(subscription, contexto = {}) {
  if (subscription.pppoeDisabled) {
    return {
      ok: true,
      omitted: true,
      command: '',
      result: 'El PPPoE ya estaba desactivado.',
      durationMs: 0,
      subscription,
    };
  }
  return ejecutar('pppoe-disable', subscription, contexto);
}

/** Habilita el secret PPPoE sin tocar la lista MOROSOS. */
async function activarPppoe(subscription, contexto = {}) {
  if (!subscription.pppoeDisabled) {
    return {
      ok: true,
      omitted: true,
      command: '',
      result: 'El PPPoE ya estaba activo.',
      durationMs: 0,
      subscription,
    };
  }
  return ejecutar('pppoe-enable', subscription, contexto);
}

async function probarConexion(settings, actor = 'admin') {
  const driver = crearDriver(settings);
  const inicio = Date.now();
  try {
    const resultado = await driver.testConnection();
    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'test_connection',
      description: 'Prueba de conexión con el router.',
      command: resultado.command,
      commandResult: resultado.result,
      status: 'success',
      durationMs: resultado.durationMs ?? Date.now() - inicio,
      actor,
    });
    return resultado;
  } catch (error) {
    await registrar({
      module: 'settings',
      entity: 'Settings',
      entityId: settings._id,
      action: 'test_connection',
      description: 'La prueba de conexión con el router falló.',
      command: '/system/identity/print',
      commandResult: error.message,
      status: 'failed',
      durationMs: Date.now() - inicio,
      actor,
    });
    return { ok: false, command: '/system/identity/print', result: error.message, durationMs: Date.now() - inicio };
  }
}

/** Devuelve el comando que se ejecutaría, sin tocar el router. */
async function previsualizar(accion, subscription) {
  const completa = await prepararSubscription(subscription);
  const plan = construirComando(accion, completa);
  return { ...plan, subscription: completa };
}

module.exports = {
  bloquear,
  desbloquear,
  desactivarPppoe,
  activarPppoe,
  probarConexion,
  previsualizar,
  construirComando,
  configuracion,
  registrar,
  auditService,
};
