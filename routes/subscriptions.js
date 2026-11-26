const express = require('express');
const Subscription = require('../models/Subscription');
const firewallService = require('../services/firewallService');
const routerService = require('../services/routerService');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { requierePermiso } = require('../middlewares/auth');

const router = express.Router();

/** POST /suscripciones/:id/cortar */
router.post('/:id/cortar', requierePermiso('clientes.cortes'), async (req, res, next) => {
  try {
    const subscription = await Subscription.findById(req.params.id).populate('clientId');
    if (!subscription) throw crearError(404, 'La suscripción no existe.');
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) {
      req.flash('error', 'El motivo del corte es obligatorio.');
      return res.redirect(`/clientes/${subscription.clientId._id}?tab=servicio`);
    }
    const resultado = await firewallService.bloquear(subscription, {
      reason: `Corte manual: ${motivo}`,
      estadoAnterior: {
        status: subscription.status,
        firewallState: subscription.firewallState,
        pppoeDisabled: subscription.pppoeDisabled,
      },
      actor: req.usuario?.username || 'admin',
    });
    if (resultado.ok) req.flash('exito', resultado.omitted ? 'El servicio ya estaba cortado.' : 'Cliente agregado a la lista MOROSOS y reglas de firewall aseguradas.');
    else req.flash('error', `No se pudo aplicar el corte: ${resultado.result}`);
    res.redirect(`/clientes/${subscription.clientId._id}?tab=servicio`);
  } catch (error) {
    next(error);
  }
});

/** POST /suscripciones/:id/restaurar */
router.post('/:id/restaurar', requierePermiso('clientes.cortes'), async (req, res, next) => {
  try {
    const subscription = await Subscription.findById(req.params.id).populate('clientId');
    if (!subscription) throw crearError(404, 'La suscripción no existe.');
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) {
      req.flash('error', 'El motivo de la restauración es obligatorio.');
      return res.redirect(`/clientes/${subscription.clientId._id}?tab=servicio`);
    }
    const resultado = await firewallService.desbloquear(subscription, {
      reason: `Restauración manual: ${motivo}`,
      estadoAnterior: {
        status: subscription.status,
        firewallState: subscription.firewallState,
        pppoeDisabled: subscription.pppoeDisabled,
      },
      actor: req.usuario?.username || 'admin',
    });
    if (resultado.ok) req.flash('exito', resultado.omitted ? 'El servicio ya estaba activo.' : 'Servicio restaurado: IP fuera de MOROSOS y PPPoE habilitado si estaba desactivado.');
    else req.flash('error', `El servicio quedó con error de firewall: ${resultado.result}`);
    res.redirect(`/clientes/${subscription.clientId._id}?tab=servicio`);
  } catch (error) {
    next(error);
  }
});

/** POST /suscripciones/:id/pppoe/desactivar */
router.post('/:id/pppoe/desactivar', requierePermiso('clientes.cortes'), async (req, res, next) => {
  try {
    const subscription = await Subscription.findById(req.params.id).populate('clientId');
    if (!subscription) throw crearError(404, 'La suscripción no existe.');
    const motivo = String(req.body.motivo || '').trim();
    const resultado = await firewallService.desactivarPppoe(subscription, {
      reason: motivo ? `Desactivación manual: ${motivo}` : 'Desactivación manual',
      estadoAnterior: {
        status: subscription.status,
        firewallState: subscription.firewallState,
        pppoeDisabled: subscription.pppoeDisabled,
      },
      actor: req.usuario?.username || 'admin',
    });
    if (resultado.ok) {
      req.flash('exito', resultado.omitted ? 'El PPPoE ya estaba desactivado.' : 'PPPoE desactivado y comando registrado.');
    } else {
      req.flash('error', `No se pudo desactivar el PPPoE: ${resultado.result}`);
    }
    res.redirect(`/clientes/${subscription.clientId._id}?tab=servicio`);
  } catch (error) {
    next(error);
  }
});

/** POST /suscripciones/:id/pppoe/activar */
router.post('/:id/pppoe/activar', requierePermiso('clientes.cortes'), async (req, res, next) => {
  try {
    const subscription = await Subscription.findById(req.params.id).populate('clientId');
    if (!subscription) throw crearError(404, 'La suscripción no existe.');
    const motivo = String(req.body.motivo || '').trim();
    const resultado = await firewallService.activarPppoe(subscription, {
      reason: motivo ? `Activación manual: ${motivo}` : 'Activación manual',
      estadoAnterior: {
        status: subscription.status,
        firewallState: subscription.firewallState,
        pppoeDisabled: subscription.pppoeDisabled,
      },
      actor: req.usuario?.username || 'admin',
    });
    if (resultado.ok) {
      req.flash('exito', resultado.omitted ? 'El PPPoE ya estaba activo.' : 'PPPoE activado y comando registrado.');
    } else {
      req.flash('error', `No se pudo activar el PPPoE: ${resultado.result}`);
    }
    res.redirect(`/clientes/${subscription.clientId._id}?tab=servicio`);
  } catch (error) {
    next(error);
  }
});

/** POST /suscripciones/:id/eliminar — borra el servicio y su PPPoE/cola del router. */
router.post('/:id/eliminar', requierePermiso('clientes.servicio'), async (req, res, next) => {
  try {
    const subscription = await Subscription.findById(req.params.id).populate('clientId');
    if (!subscription) throw crearError(404, 'La suscripción no existe.');
    const clienteId = subscription.clientId?._id || subscription.clientId;

    const resultado = await routerService.aprovisionar(subscription, {
      accion: 'delete',
      actor: req.usuario?.username || 'admin',
    });
    if (!resultado.ok) {
      const fallo = resultado.resultados.find((r) => !r.ok);
      req.flash('error', `El router no confirmó la limpieza; el servicio no se eliminó. ${fallo ? fallo.result : ''}`.trim());
      return res.redirect(`/clientes/${clienteId}?tab=servicio`);
    }

    await Subscription.deleteOne({ _id: subscription._id });
    await registrar({
      module: 'provisioning',
      entity: 'Subscription',
      entityId: subscription._id,
      action: 'delete',
      description: `Servicio eliminado de ${subscription.clientId?.clientCode || 'cliente'} (${resultado.simulado ? 'simulado' : 'real'}).`,
      changes: {
        before: {
          plan: subscription.planSnapshot?.name || null,
          ip: subscription.serviceConfig?.ipAddress || null,
          pppoe: subscription.serviceConfig?.pppoeUsername || null,
        },
      },
      command: resultado.comandos.map((c) => c.comando).join('\n'),
      commandResult: resultado.salida,
      status: 'success',
      actor: req.usuario?.username || 'admin',
    });

    req.flash('exito', 'Servicio eliminado. El PPPoE, la cola y las listas de firewall se retiraron del router.');
    res.redirect(`/clientes/${clienteId}?tab=servicio`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
