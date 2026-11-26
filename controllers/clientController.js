const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { hashPassword } = require('../utils/password');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Router = require('../models/Router');
const IpPool = require('../models/IpPool');
const Subscription = require('../models/Subscription');
const Sale = require('../models/Sale');
const Invoice = require('../models/Invoice');
const Ticket = require('../models/Ticket');
const FaultReport = require('../models/FaultReport');
const InstallationReport = require('../models/InstallationReport');
const AuditLog = require('../models/AuditLog');
const { resolverActores } = require('../services/auditActors');
const billingService = require('../services/billingService');
const firewallService = require('../services/firewallService');
const routerService = require('../services/routerService');
const planService = require('../services/planService');
const salesService = require('../services/salesService');
const clientStatusService = require('../services/clientStatusService');
const { registrar } = require('../services/auditService');
const { normalizarMac } = require('../utils/mac');
const { cifrar } = require('../services/cryptoService');
const { sumarIntervalo } = require('../utils/dates');
const { puedeVer, puedeEditar } = require('../utils/permissions');
const { enumerarCidr, contarIps, esIpValida, ipEnCidr } = require('../utils/ip');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const { CLIENTES_POR_PAGINA, ETIQUETAS_ESTADO } = require('../config/constants');
const { escaparRegex } = require('../utils/strings');

function payloadCliente(body = {}) {
  const direccion = body.address || {};
  const facturacion = body.billingData || {};
  return {
    firstName: body.firstName || '',
    lastName: body.lastName || '',
    taxId: body.taxId || '',
    email: body.email || '',
    phone: body.phone || '',
    address: {
      street: direccion.street ?? body['address.street'] ?? '',
      city: direccion.city ?? body['address.city'] ?? '',
      state: direccion.state ?? body['address.state'] ?? '',
      postalCode: direccion.postalCode ?? body['address.postalCode'] ?? '',
    },
    billingData: {
      legalName: facturacion.legalName ?? body['billingData.legalName'] ?? '',
      taxId: facturacion.taxId ?? body['billingData.taxId'] ?? '',
      email: facturacion.email ?? body['billingData.email'] ?? '',
      address: facturacion.address ?? body['billingData.address'] ?? '',
    },
    status: body.status || 'active',
    notes: body.notes || '',
  };
}

function paginar(pagina, total, limite) {
  const paginas = Math.max(1, Math.ceil(total / limite));
  const actual = Math.min(Math.max(1, Number(pagina) || 1), paginas);
  return { actual, paginas, total, limite, desde: (actual - 1) * limite };
}

/** GET /clientes */
async function index(req, res, next) {
  try {
    const { q = '', estado = '', servicio = '', plan = '', deuda = '', orden = 'nombre', page = 1 } = req.query;
    const consulta = {};
    const puedeFacturacion = puedeVer(req.usuario, 'clientes.facturacion')
      || puedeVer(req.usuario, 'finanzas.facturas')
      || puedeVer(req.usuario, 'finanzas.gestion');

    if (estado) consulta.status = estado;
    if (q.trim()) {
      const regex = new RegExp(escaparRegex(q.trim()), 'i');
      consulta.$or = [
        { firstName: regex },
        { lastName: regex },
        { clientCode: regex },
        { email: regex },
        { taxId: regex },
      ];
    }

    let idsFiltrados = null;
    if (plan || servicio) {
      /* Un cliente "sin servicio" no puede estar en un plan: ambos filtros juntos no devuelven nada. */
      if (servicio === 'sin' && plan) {
        idsFiltrados = [];
      } else if (servicio === 'sin') {
        const conServicio = await Subscription.find().select('clientId').lean();
        const excluir = new Set(conServicio.map((s) => String(s.clientId)));
        const todos = await Client.find().select('_id').lean();
        idsFiltrados = todos.map((c) => String(c._id)).filter((id) => !excluir.has(id));
      } else {
        const filtroSub = {};
        if (plan) filtroSub.planId = plan;
        if (servicio) filtroSub.status = servicio;
        const subs = await Subscription.find(filtroSub).select('clientId').lean();
        idsFiltrados = subs.map((s) => String(s.clientId));
      }
      consulta._id = { $in: idsFiltrados };
    }

    if (deuda === '1' && puedeFacturacion) {
      const conDeuda = await Invoice.aggregate([
        { $match: { status: { $in: billingService.ESTADOS_PENDIENTES } } },
        { $group: { _id: '$clientId' } },
      ]);
      const ids = conDeuda.map((fila) => fila._id);
      consulta._id = consulta._id ? { $in: ids.filter((id) => idsFiltrados.includes(String(id))) } : { $in: ids };
    }

    const ordenes = {
      nombre: { firstName: 1, lastName: 1 },
      codigo: { clientCode: 1 },
      reciente: { createdAt: -1 },
    };

    const total = await Client.countDocuments(consulta);
    const paginacion = paginar(page, total, CLIENTES_POR_PAGINA);
    const deudas = puedeFacturacion ? await billingService.deudasPorCliente() : new Map();

    let clientes;
    if (orden === 'deuda' && puedeFacturacion) {
      // Se ordena antes de paginar: los mayores deudores van en la primera página.
      const todos = await Client.find(consulta).lean();
      todos.sort(
        (a, b) => (deudas.get(String(b._id))?.total || 0) - (deudas.get(String(a._id))?.total || 0)
      );
      clientes = todos.slice(paginacion.desde, paginacion.desde + paginacion.limite);
    } else {
      clientes = await Client.find(consulta)
        .sort(ordenes[orden] || ordenes.nombre)
        .skip(paginacion.desde)
        .limit(paginacion.limite)
        .lean();
    }

    const ids = clientes.map((c) => c._id);
    const [suscripciones, clientesActivos, clientesSuspendidos, planes] = await Promise.all([
      Subscription.find({ clientId: { $in: ids } }).populate('planId').lean(),
      Client.countDocuments({ status: 'active' }),
      Client.countDocuments({ status: 'suspended' }),
      Plan.find().sort({ name: 1 }).select('name').lean(),
    ]);

    const subMap = new Map(suscripciones.map((s) => [String(s.clientId), s]));
    clientes = clientes.map((cliente) => {
      const sub = subMap.get(String(cliente._id));
      const deudaCliente = deudas.get(String(cliente._id)) || { total: 0, cantidad: 0 };
      const nombre = `${cliente.firstName} ${cliente.lastName}`.trim();
      return {
        ...cliente,
        fullName: nombre,
        initials: `${String(cliente.firstName).charAt(0)}${String(cliente.lastName).charAt(0)}`.toUpperCase(),
        subscription: sub || null,
        deuda: deudaCliente,
      };
    });

    const conDeuda = deudas.size;

    res.render('clients/index', {
      titulo: 'Clientes',
      clientes,
      paginacion,
      filtros: { q, estado, servicio, plan, deuda, orden },
      planes,
      puedeFacturacion,
      resumen: { total, activos: clientesActivos, suspendidos: clientesSuspendidos, conDeuda },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /clientes/:id */
/** Cuenta lo que impide borrar a un cliente sin dejar registros huérfanos. */
async function bloqueosCliente(id) {
  const [servicios, facturas, tickets, ventas, averias, instalaciones] = await Promise.all([
    Subscription.countDocuments({ clientId: id }),
    Invoice.countDocuments({ clientId: id }),
    Ticket.countDocuments({ clientId: id }),
    Sale.countDocuments({ clientId: id }),
    FaultReport.countDocuments({ clientId: id }),
    InstallationReport.countDocuments({ clientId: id }),
  ]);
  return { servicios, facturas, tickets, ventas, averias, instalaciones };
}

async function show(req, res, next) {
  try {
    const cliente = await Client.findById(req.params.id);
    if (!cliente) throw crearError(404, 'El cliente no existe.');

    const solicitada = ['general', 'servicio', 'monitoreo', 'facturacion', 'tickets', 'historial'].includes(req.query.tab)
      ? req.query.tab
      : 'general';
    const puedeClave = (clave) => puedeVer(req.usuario, clave);
    const tabsPermitidos = ['general'];
    if (puedeClave('clientes.servicio') || puedeClave('clientes.cortes')) tabsPermitidos.push('servicio');
    if (puedeClave('red.monitoreo')) tabsPermitidos.push('monitoreo');
    if (puedeClave('clientes.facturacion') || puedeClave('finanzas.facturas') || puedeClave('finanzas.gestion')) {
      tabsPermitidos.push('facturacion');
    }
    if (puedeClave('soporte.tickets')) tabsPermitidos.push('tickets');
    if (puedeClave('clientes.datos') || puedeClave('general.clientes')) tabsPermitidos.push('historial');
    const tab = tabsPermitidos.includes(solicitada) ? solicitada : 'general';
    const puedeFacturacion = puedeClave('clientes.facturacion')
      || puedeClave('finanzas.facturas')
      || puedeClave('finanzas.gestion');

    const [subscription, invoices, planes, deuda, routers, pools, tickets, bloqueos] = await Promise.all([
      Subscription.findOne({ clientId: cliente._id })
        .populate('planId')
        .populate('clientId')
        .populate('serviceConfig.routerId')
        .populate('serviceConfig.ipPoolId'),
      puedeFacturacion ? Invoice.find({ clientId: cliente._id }).sort({ issueDate: -1 }) : [],
      Plan.find({ active: true }).sort({ name: 1 }),
      puedeFacturacion ? billingService.deudaCliente(cliente._id) : { total: 0, cantidad: 0 },
      Router.find({ active: true }).sort({ name: 1 }).lean(),
      IpPool.find({ active: true }).sort({ name: 1 }).lean(),
      Ticket.find({ clientId: cliente._id }).sort({ createdAt: -1 }).limit(10),
      bloqueosCliente(cliente._id),
    ]);

    const idsFacturas = invoices.map((f) => String(f._id));
    const logs = await AuditLog.find({
      $or: [
        { entityId: String(cliente._id) },
        ...(subscription ? [{ entityId: String(subscription._id) }] : []),
        { entityId: { $in: idsFacturas } },
      ],
    })
      .sort({ timestamp: -1 })
      .limit(30)
      .lean();
    await resolverActores(logs);

    const ultimoFirewall = logs.find((log) => log.module === 'firewall');
    const servicioForm = req.session.servicioForm || null;
    if (servicioForm) delete req.session.servicioForm;

    res.render('clients/show', {
      titulo: `${cliente.fullName} · Cliente`,
      cliente,
      subscription,
      invoices,
      planes,
      deuda,
      tab,
      tabsPermitidos,
      puedeFacturacion,
      logs,
      ultimoFirewall,
      servicioForm,
      routers,
      pools,
      tickets,
      bloqueos,
      modos: ETIQUETAS_ESTADO,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /clientes/nuevo */
async function formNuevo(req, res, next) {
  try {
    const cliente = new Client({
      clientCode: await Client.siguienteCodigo(),
      status: 'active',
    });
    res.render('clients/form', {
      titulo: 'Nuevo cliente',
      cliente,
      modo: 'crear',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** POST /clientes */
async function crear(req, res, next) {
  try {
    const cliente = new Client({
      clientCode: await Client.siguienteCodigo(),
      ...payloadCliente(req.body),
    });
    await cliente.save();

    await registrar({
      module: 'commercial',
      entity: 'Client',
      entityId: cliente._id,
      action: 'create',
      description: `Cliente ${cliente.clientCode} creado: ${cliente.fullName}.`,
      changes: { after: { clientCode: cliente.clientCode, fullName: cliente.fullName } },
    });

    req.flash('exito', `Cliente ${cliente.clientCode} creado correctamente.`);
    res.redirect(`/clientes/${cliente._id}?tab=general`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      const cliente = new Client(payloadCliente(req.body));
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('clients/form', {
        titulo: 'Nuevo cliente',
        cliente,
        modo: 'crear',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** GET /clientes/:id/editar */
async function formEditar(req, res, next) {
  try {
    const cliente = await Client.findById(req.params.id);
    if (!cliente) throw crearError(404, 'El cliente no existe.');
    res.render('clients/form', {
      titulo: `Editar ${cliente.fullName}`,
      cliente,
      modo: 'editar',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /clientes/:id */
async function actualizar(req, res, next) {
  try {
    const cliente = await Client.findById(req.params.id);
    if (!cliente) throw crearError(404, 'El cliente no existe.');
    const antes = {
      fullName: cliente.fullName,
      email: cliente.email,
      phone: cliente.phone,
      status: cliente.status,
    };

    Object.assign(cliente, payloadCliente(req.body));
    await cliente.save();

    await registrar({
      module: 'commercial',
      entity: 'Client',
      entityId: cliente._id,
      action: 'update',
      description: `Cliente ${cliente.clientCode} actualizado.`,
      changes: { before: antes, after: { fullName: cliente.fullName, email: cliente.email, phone: cliente.phone, status: cliente.status } },
    });

    req.flash('exito', 'Cliente actualizado correctamente.');
    res.redirect(`/clientes/${cliente._id}?tab=general`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) {
      const cliente = await Client.findById(req.params.id);
      if (cliente) Object.assign(cliente, payloadCliente(req.body));
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('clients/form', {
        titulo: `Editar ${cliente?.fullName || 'cliente'}`,
        cliente: cliente || new Client(payloadCliente(req.body)),
        modo: 'editar',
        errores: lista,
        erroresCampo: campos,
      });
    }
    next(error);
  }
}

/** DELETE /clientes/:id */
async function eliminar(req, res, next) {
  try {
    const cliente = await Client.findById(req.params.id);
    if (!cliente) throw crearError(404, 'El cliente no existe.');

    const bloqueos = await bloqueosCliente(cliente._id);
    const total = Object.values(bloqueos).reduce((suma, valor) => suma + valor, 0);

    if (total) {
      req.flash(
        'error',
        `No se puede eliminar a ${cliente.fullName}: tiene ${bloqueos.servicios} servicio(s), ${bloqueos.facturas} factura(s), ${bloqueos.tickets} ticket(s), ${bloqueos.ventas} venta(s), ${bloqueos.averias} avería(s) y ${bloqueos.instalaciones} instalación(es). Márcalo como retirado en su lugar.`
      );
      return res.redirect(`/clientes/${cliente._id}?tab=general`);
    }

    await cliente.deleteOne();
    await registrar({
      module: 'commercial',
      entity: 'Client',
      entityId: cliente._id,
      action: 'delete',
      description: `Cliente ${cliente.clientCode} eliminado.`,
      changes: { before: { clientCode: cliente.clientCode, fullName: cliente.fullName } },
    });

    req.flash('exito', 'Cliente eliminado correctamente.');
    res.redirect('/clientes');
  } catch (error) {
    next(error);
  }
}

/** POST /clientes/verificar-estados */
async function verificarEstados(req, res, next) {
  try {
    const resumen = await clientStatusService.verificarEstados({ actor: req.usuario ? req.usuario.username : 'admin' });
    req.flash(
      'exito',
      `Verificación de facturación: ${resumen.revisados} cliente(s) revisados, ${resumen.suspendidos} suspendido(s), ${resumen.reactivados} reactivado(s).`
    );
    res.redirect('/clientes');
  } catch (error) {
    next(error);
  }
}

/** GET /clientes/:id/servicio/nuevo */
async function formServicio(req, res, next) {
  try {
    const cliente = await Client.findById(req.params.id);
    if (!cliente) throw crearError(404, 'El cliente no existe.');
    const existente = await Subscription.findOne({ clientId: cliente._id });
    if (existente) {
      req.flash('error', 'El cliente ya tiene un servicio contratado.');
      return res.redirect(`/clientes/${cliente._id}?tab=servicio`);
    }
    const planes = await Plan.find({ active: true }).sort({ price: 1 });
    const [routers, pools] = await Promise.all([
      Router.find({ active: true }).sort({ name: 1 }).lean(),
      IpPool.find({ active: true }).sort({ name: 1 }).lean(),
    ]);
    res.render('subscriptions/form', {
      titulo: `Nuevo servicio · ${cliente.fullName}`,
      cliente,
      subscription: null,
      planes,
      routers,
      pools,
      modo: 'crear',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** POST /clientes/:id/servicio */
async function crearServicio(req, res, next) {
  try {
    const cliente = await Client.findById(req.params.id);
    if (!cliente) throw crearError(404, 'El cliente no existe.');
    if (await Subscription.findOne({ clientId: cliente._id })) {
      req.flash('error', 'El cliente ya tiene un servicio contratado.');
      return res.redirect(`/clientes/${cliente._id}?tab=servicio`);
    }

    const plan = req.body.planId && mongoose.isValidObjectId(req.body.planId)
      ? await Plan.findById(req.body.planId)
      : null;
    if (!plan || !plan.active) {
      const error = crearError(422, 'El plan seleccionado no está disponible.');
      error.campos = { planId: 'Selecciona un plan activo.' };
      throw error;
    }

    const tipo = req.body.connectionType || 'pppoe';
    let routerId = req.body.routerId || null;
    let router = null;
    const pool = req.body.ipPoolId && mongoose.isValidObjectId(req.body.ipPoolId)
      ? await IpPool.findById(req.body.ipPoolId)
      : null;
    if (req.body.ipPoolId && !pool) {
      const error = crearError(422, 'El pool de IP seleccionado no existe.');
      error.campos = { ipPoolId: 'El pool seleccionado no existe.' };
      throw error;
    }
    if (routerId) {
      router = mongoose.isValidObjectId(routerId) ? await Router.findById(routerId) : null;
      if (!router) {
        const error = crearError(422, 'El router seleccionado no existe.');
        error.campos = { routerId: 'El router seleccionado no existe.' };
        throw error;
      }
    } else {
      router = await planService.routerCompatible(plan, Router);
      if (!router) {
        const error = crearError(422, 'No hay un router compatible con este plan.');
        error.campos = { routerId: 'Selecciona un router compatible o crea uno para este tipo de plan.' };
        throw error;
      }
      routerId = router._id;
    }
    if (!planService.routerPermitido(plan, router)) {
      const error = crearError(422, 'El plan no se puede usar en el router seleccionado.');
      error.campos = plan.trafficMode === 'address_list'
        ? { planId: 'Este plan no está habilitado para el router elegido.' }
        : { routerId: 'El router no maneja este tipo de plan.' };
      throw error;
    }
    if (pool && routerId && String(pool.routerId) !== String(routerId)) {
      const error = crearError(422, 'El pool de IP pertenece a otro router.');
      error.campos = { ipPoolId: 'Este pool pertenece a otro router.' };
      throw error;
    }

    let usuario = '';
    let password = '';
    let ip = String(req.body.ipAddress || '').trim();
    if (tipo === 'pppoe') {
      usuario = String(req.body.pppoeUsername || '').trim().toLowerCase() || (await salesService.generarUsuarioPppoe(cliente));
      password = req.body.pppoePassword || salesService.generarPassword();
    }
    if (!ip && pool) {
      ip = (await salesService.siguienteIp(pool)) || '';
    }
    if (['static', 'dhcp'].includes(tipo) && !ip && !pool) {
      const error = crearError(422, 'Indica una IP o selecciona un pool.');
      error.campos = { ipAddress: 'Indica una IP o selecciona un pool.' };
      throw error;
    }
    if (plan.trafficMode === 'address_list' && !ip) {
      const error = crearError(422, 'Los planes por address list necesitan una IP fija.');
      error.campos = { ipAddress: 'Selecciona una IP del pool o escribe una IP válida.' };
      throw error;
    }

    if (ip) {
      if (!esIpValida(ip)) {
        const error = crearError(422, 'La IP no es válida.');
        error.campos = { ipAddress: 'Escribe una IP válida, por ejemplo 10.10.0.20.' };
        throw error;
      }
      if (pool && !ipEnCidr(ip, pool.cidr)) {
        const error = crearError(422, 'La IP no pertenece al pool seleccionado.');
        error.campos = { ipAddress: `La IP debe estar dentro de ${pool.cidr}.` };
        throw error;
      }
      const ocupada = (await Subscription.exists({ 'serviceConfig.ipAddress': ip }))
        || (await Sale.exists({ status: 'waiting', 'service.ipAddress': ip }));
      if (ocupada) {
        const error = crearError(422, 'La IP ya está asignada.');
        error.campos = { ipAddress: `La IP ${ip} ya está asignada a otro cliente.` };
        throw error;
      }
    }

    const mac = normalizarMac(req.body.macAddress);
    const macAuth = req.body.macAuthEnabled === 'on' || req.body.macAuthEnabled === 'true';
    if (req.body.macAddress && !mac) {
      const error = crearError(422, 'La MAC no es válida.');
      error.campos = { macAddress: 'Escribe una MAC válida, por ejemplo AA:BB:CC:DD:EE:FF.' };
      throw error;
    }
    if (macAuth && !mac) {
      const error = crearError(422, 'La autenticación por MAC necesita una MAC.');
      error.campos = { macAddress: 'Escribe la MAC del equipo para autenticarlo.' };
      throw error;
    }
    if (macAuth && mac) {
      const usada = (await Subscription.exists({ 'serviceConfig.macAuthEnabled': true, 'serviceConfig.macAddress': mac }))
        || (await Sale.exists({ status: 'waiting', 'service.macAuthEnabled': true, 'service.macAddress': mac }));
      if (usada) {
        const error = crearError(422, 'La MAC ya está autenticada en otro servicio.');
        error.campos = { macAddress: `La MAC ${mac} ya está asignada a otro servicio o venta.` };
        throw error;
      }
    }

    const ahora = new Date();
    const subscription = new Subscription({
      clientId: cliente._id,
      planId: plan._id,
      planSnapshot: plan.snapshot,
      serviceConfig: {
        connectionType: tipo,
        ipAddress: ip,
        pppoeUsername: usuario,
        macAddress: mac,
        macAuthEnabled: macAuth,
        pppoePasswordEnc: password ? cifrar(password) : '',
        routerId,
        ipPoolId: pool?._id || null,
        queueName: plan.trafficMode === 'address_list'
          ? ''
          : routerService.nombreCola({ serviceConfig: { pppoeUsername: usuario }, clientId: cliente }),
      },
      status: 'active',
      currentPeriodStart: ahora,
      currentPeriodEnd: sumarIntervalo(ahora, plan.billingInterval),
      installedAt: req.body.installedAt ? new Date(req.body.installedAt) : ahora,
      notes: req.body.notes || '',
    });

    await subscription.save();

    let aprovisionamiento = null;
    let errorAprovisionamiento = '';
    try {
      aprovisionamiento = await routerService.aprovisionar(subscription, { accion: 'create' });
    } catch (error) {
      errorAprovisionamiento = error.message;
      subscription.serviceConfig.provisioningState = 'error';
      subscription.serviceConfig.lastProvisionResult = error.message;
      await subscription.save();
    }

    await registrar({
      module: 'technical',
      entity: 'Subscription',
      entityId: subscription._id,
      action: 'create',
      description: `Servicio ${plan.name} creado para ${cliente.clientCode}${routerId ? ` en el router seleccionado` : ''}.`,
      changes: {
        after: {
          plan: plan.name,
          connectionType: tipo,
          ip,
          pppoeUsername: usuario,
          aprovisionamiento: aprovisionamiento?.ok ? 'ok' : 'error',
        },
      },
    });

    const falloRouter = errorAprovisionamiento
      || (!aprovisionamiento || aprovisionamiento.ok
        ? ''
        : (aprovisionamiento.resultados || []).find((r) => !r.ok)?.result || aprovisionamiento.salida || 'sin detalle');
    if (falloRouter) {
      req.flash('error', `Servicio ${plan.name} guardado, pero el router rechazó el aprovisionamiento: ${falloRouter}`);
    } else {
      req.flash(
        'exito',
        `Servicio ${plan.name} asignado a ${cliente.fullName}.` +
          (password && !req.body.pppoePassword ? ` Contraseña PPPoE generada: ${password}` : '')
      );
    }
    res.redirect(`/clientes/${cliente._id}?tab=servicio`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const cliente = await Client.findById(req.params.id);
      if (!cliente) return next(error);
      const [planes, routers, pools] = await Promise.all([
        Plan.find({ active: true }).sort({ price: 1 }),
        Router.find({ active: true }).sort({ name: 1 }).lean(),
        IpPool.find({ active: true }).sort({ name: 1 }).lean(),
      ]);
      const { lista, campos } = normalizarErrores(error, {
        'serviceConfig.pppoeUsername': 'pppoeUsername',
        'serviceConfig.ipAddress': 'ipAddress',
      });
      return res.status(422).render('subscriptions/form', {
        titulo: `Nuevo servicio · ${cliente?.fullName || ''}`,
        cliente,
        subscription: null,
        planes,
        routers,
        pools,
        modo: 'crear',
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

/** PUT /clientes/:id/servicio */
async function actualizarServicio(req, res, next) {
  try {
    const subscription = await Subscription.findOne({ clientId: req.params.id });
    if (!subscription) throw crearError(404, 'El cliente no tiene un servicio contratado.');
    const antes = { ...subscription.serviceConfig };
    const plan = await Plan.findById(subscription.planId);
    if (!plan) throw crearError(404, 'El plan del servicio no existe.');

    const tipo = req.body.connectionType || subscription.serviceConfig.connectionType;
    const pool = req.body.ipPoolId ? await IpPool.findById(req.body.ipPoolId) : null;
    if (pool && req.body.routerId && String(pool.routerId) !== String(req.body.routerId)) {
      const error = crearError(422, 'El pool de IP pertenece a otro router.');
      error.campos = { ipPoolId: 'Este pool pertenece a otro router.' };
      throw error;
    }
    let router = null;
    if (req.body.routerId) {
      router = mongoose.isValidObjectId(req.body.routerId) ? await Router.findById(req.body.routerId) : null;
    } else {
      router = await planService.routerCompatible(plan, Router);
    }
    if (!router) {
      const error = crearError(422, 'Selecciona un router compatible con el plan.');
      error.campos = { routerId: 'No hay un router compatible disponible.' };
      throw error;
    }
    if (!planService.routerPermitido(plan, router)) {
      const error = crearError(422, 'El plan no se puede usar en el router seleccionado.');
      error.campos = { routerId: 'Este router no maneja el modo del plan.' };
      throw error;
    }
    if (pool && String(pool.routerId) !== String(router._id)) {
      const error = crearError(422, 'El pool de IP pertenece a otro router.');
      error.campos = { ipPoolId: 'Este pool pertenece a otro router.' };
      throw error;
    }
    subscription.serviceConfig.connectionType = tipo;
    subscription.serviceConfig.routerId = router._id;
    subscription.serviceConfig.ipPoolId = pool?._id || null;
    subscription.serviceConfig.ipAddress = String(req.body.ipAddress || '').trim();
    subscription.serviceConfig.pppoeUsername = tipo === 'pppoe' ? req.body.pppoeUsername || '' : '';
    const macRaw = String(req.body.macAddress || '').trim().toUpperCase();
    const mac = normalizarMac(macRaw);
    const macAuth = req.body.macAuthEnabled === 'on' || req.body.macAuthEnabled === 'true';
    subscription.serviceConfig.macAddress = mac;
    subscription.serviceConfig.macAuthEnabled = macAuth;
    if (macRaw && !mac) {
      const error = crearError(422, 'La MAC no es válida.');
      error.campos = { macAddress: 'Escribe una MAC válida, por ejemplo AA:BB:CC:DD:EE:FF.' };
      throw error;
    }
    if (macAuth && !mac) {
      const error = crearError(422, 'La autenticación por MAC necesita una MAC.');
      error.campos = { macAddress: 'Escribe la MAC del equipo para autenticarlo.' };
      throw error;
    }
    if (macAuth && mac) {
      const usada = (await Subscription.exists({ _id: { $ne: subscription._id }, 'serviceConfig.macAuthEnabled': true, 'serviceConfig.macAddress': mac }))
        || (await Sale.exists({ status: 'waiting', 'service.macAuthEnabled': true, 'service.macAddress': mac }));
      if (usada) {
        const error = crearError(422, 'La MAC ya está autenticada en otro servicio.');
        error.campos = { macAddress: `La MAC ${mac} ya está asignada a otro servicio o venta.` };
        throw error;
      }
    }
    if (tipo === 'pppoe' && req.body.pppoePassword) {
      subscription.serviceConfig.pppoePasswordEnc = cifrar(req.body.pppoePassword);
    }
    if (!subscription.serviceConfig.ipAddress && pool) {
      subscription.serviceConfig.ipAddress = (await salesService.siguienteIp(pool)) || '';
    }

    const ipNueva = String(subscription.serviceConfig.ipAddress || '').trim();
    if (ipNueva) {
      if (!esIpValida(ipNueva)) {
        const error = crearError(422, 'La IP no es válida.');
        error.campos = { ipAddress: 'Escribe una IP válida.' };
        throw error;
      }
      if (pool && !ipEnCidr(ipNueva, pool.cidr)) {
        const error = crearError(422, 'La IP no pertenece al pool seleccionado.');
        error.campos = { ipAddress: `La IP debe estar dentro de ${pool.cidr}.` };
        throw error;
      }
      const ocupada = (await Subscription.exists({ _id: { $ne: subscription._id }, 'serviceConfig.ipAddress': ipNueva }))
        || (await Sale.exists({ status: 'waiting', 'service.ipAddress': ipNueva }));
      if (ocupada) {
        const error = crearError(422, 'La IP ya está asignada.');
        error.campos = { ipAddress: `La IP ${ipNueva} ya está asignada a otro cliente.` };
        throw error;
      }
    }
    if (plan.trafficMode === 'address_list' && !subscription.serviceConfig.ipAddress) {
      const error = crearError(422, 'Los planes por address list necesitan una IP fija.');
      error.campos = { ipAddress: 'Selecciona una IP del pool.' };
      throw error;
    }
    subscription.notes = req.body.notes || subscription.notes;

    await subscription.save();

    let aprovisionamiento = null;
    let errorAprovisionamiento = '';
    try {
      aprovisionamiento = await routerService.aprovisionar(subscription, { accion: 'update' });
    } catch (error) {
      errorAprovisionamiento = error.message;
      subscription.serviceConfig.provisioningState = 'error';
      subscription.serviceConfig.lastProvisionResult = error.message;
      await subscription.save();
    }

    await registrar({
      module: 'technical',
      entity: 'Subscription',
      entityId: subscription._id,
      action: 'update',
      description: `Configuración del servicio actualizada (${ETIQUETAS_ESTADO[tipo] || tipo}).`,
      changes: {
        before: { connectionType: antes.connectionType, ipAddress: antes.ipAddress, pppoeUsername: antes.pppoeUsername },
        after: {
          connectionType: subscription.serviceConfig.connectionType,
          ipAddress: subscription.serviceConfig.ipAddress,
          pppoeUsername: subscription.serviceConfig.pppoeUsername,
          aprovisionamiento: aprovisionamiento?.ok ? 'ok' : 'error',
        },
      },
    });

    const falloRouter = errorAprovisionamiento
      || (!aprovisionamiento || aprovisionamiento.ok
        ? ''
        : (aprovisionamiento.resultados || []).find((r) => !r.ok)?.result || aprovisionamiento.salida || 'sin detalle');
    if (falloRouter) {
      req.flash('error', `Configuración guardada, pero el router rechazó el aprovisionamiento: ${falloRouter}`);
    } else {
      req.flash('exito', 'Configuración del servicio actualizada.');
    }
    res.redirect(`/clientes/${req.params.id}?tab=servicio`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.status) {
      const { lista, campos } = normalizarErrores(error, {
        'serviceConfig.pppoeUsername': 'pppoeUsername',
        'serviceConfig.ipAddress': 'ipAddress',
      });
      req.session.servicioForm = { valores: req.body, errores: lista, campos };
      return res.redirect(`/clientes/${req.params.id}?tab=servicio`);
    }
    next(error);
  }
}

/** PUT /clientes/:id/servicio/plan */
async function cambiarPlan(req, res, next) {
  try {
    const subscription = await Subscription.findOne({ clientId: req.params.id });
    if (!subscription) throw crearError(404, 'El cliente no tiene un servicio contratado.');
    const plan = await Plan.findById(req.body.planId);
    if (!plan || !plan.active) throw crearError(422, 'El plan seleccionado no está disponible.');
    const router = await Router.findById(subscription.serviceConfig.routerId);
    if (!planService.routerPermitido(plan, router)) {
      req.flash('error', 'El plan seleccionado no se puede usar en el router de este servicio.');
      return res.redirect(`/clientes/${req.params.id}?tab=servicio`);
    }
    if ((plan.trafficMode || 'simple_queue') !== (subscription.planSnapshot.trafficMode || 'simple_queue')) {
      req.flash('error', 'El plan pertenece a otro tipo de aprovisionamiento. Crea un servicio nuevo o cambia el router.');
      return res.redirect(`/clientes/${req.params.id}?tab=servicio`);
    }

    const anterior = subscription.planSnapshot.name;
    subscription.planId = plan._id;
    subscription.planSnapshot = plan.snapshot;
    await subscription.save();

    let falloRouter = '';
    try {
      const sincronizacion = await routerService.aprovisionar(subscription, { accion: 'update' });
      if (!sincronizacion.ok) {
        falloRouter = (sincronizacion.resultados || []).find((r) => !r.ok)?.result || sincronizacion.salida || 'sin detalle';
      }
    } catch (error) {
      falloRouter = error.message;
      console.error('⚠️  No se pudo sincronizar la cola del plan:', error.message);
    }

    await registrar({
      module: 'technical',
      entity: 'Subscription',
      entityId: subscription._id,
      action: 'update',
      description: `Cambio de plan de ${anterior} a ${plan.name}.`,
      changes: { before: { plan: anterior }, after: { plan: plan.name, price: plan.price } },
    });

    if (falloRouter) {
      req.flash('error', `Plan cambiado a ${plan.name}, pero el router rechazó la sincronización: ${falloRouter}`);
    } else {
      req.flash('exito', `Plan cambiado a ${plan.name}. Las facturas anteriores no se modifican.`);
    }
    res.redirect(`/clientes/${req.params.id}?tab=servicio`);
  } catch (error) {
    next(error);
  }
}

async function cortar(req, res, next) {
  try {
    const subscription = await Subscription.findOne({ clientId: req.params.id }).populate('clientId');
    if (!subscription) throw crearError(404, 'El cliente no tiene un servicio contratado.');
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) {
      req.flash('error', 'El motivo del corte es obligatorio.');
      return res.redirect(`/clientes/${req.params.id}?tab=servicio`);
    }

    const resultado = await firewallService.bloquear(subscription, {
      reason: `Corte manual: ${motivo}`,
      estadoAnterior: { status: subscription.status, firewallState: subscription.firewallState },
    });

    if (resultado.ok) {
      req.flash('exito', resultado.omitted ? 'El servicio ya estaba cortado.' : 'Servicio cortado y comando registrado en auditoría.');
    } else {
      req.flash('error', `No se pudo aplicar el corte: ${resultado.result}`);
    }
    res.redirect(`/clientes/${req.params.id}?tab=servicio`);
  } catch (error) {
    next(error);
  }
}

async function restaurar(req, res, next) {
  try {
    const subscription = await Subscription.findOne({ clientId: req.params.id }).populate('clientId');
    if (!subscription) throw crearError(404, 'El cliente no tiene un servicio contratado.');
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) {
      req.flash('error', 'El motivo de la restauración es obligatorio.');
      return res.redirect(`/clientes/${req.params.id}?tab=servicio`);
    }

    const resultado = await firewallService.desbloquear(subscription, {
      reason: `Restauración manual: ${motivo}`,
      estadoAnterior: { status: subscription.status, firewallState: subscription.firewallState },
    });

    if (resultado.ok) {
      req.flash('exito', resultado.omitted ? 'El servicio ya estaba activo.' : 'Servicio restaurado y comando registrado en auditoría.');
    } else {
      req.flash('error', `El servicio quedó con error de firewall: ${resultado.result}`);
    }
    res.redirect(`/clientes/${req.params.id}?tab=servicio`);
  } catch (error) {
    next(error);
  }
}

/** GET /clientes/api/pools/:poolId/ips — IPs disponibles de un pool. */
async function apiIpsPool(req, res, next) {
  try {
    const pool = await IpPool.findById(req.params.poolId).lean();
    if (!pool) throw crearError(404, 'El pool no existe.');

    const total = contarIps(pool.cidr);
    const todas = enumerarCidr(pool.cidr, 2048);
    const claves = [{ 'serviceConfig.ipPoolId': pool._id }];
    if (pool.routerId) claves.push({ 'serviceConfig.routerId': pool.routerId });
    const [servicios, ventas] = await Promise.all([
      Subscription.find({
        $or: claves,
        'serviceConfig.ipAddress': { $nin: ['', null] },
      })
        .select('serviceConfig.ipAddress')
        .lean(),
      Sale.find({ status: 'waiting', 'service.ipAddress': { $nin: ['', null] } })
        .select('service.ipAddress')
        .lean(),
    ]);
    const usadas = new Set(
      [
        ...servicios.map((s) => s.serviceConfig.ipAddress),
        ...ventas.map((v) => v.service.ipAddress),
      ].filter(Boolean)
    );

    const actual = String(req.query.actual || '').trim();
    const libres = todas.filter((ip) => !usadas.has(ip) || ip === actual);
    const usadasEnPool = [...usadas].filter((ip) => ipEnCidr(ip, pool.cidr)).length;

    res.json({
      ok: true,
      pool: {
        id: String(pool._id),
        name: pool.name,
        cidr: pool.cidr,
        routerId: pool.routerId ? String(pool.routerId) : '',
        total,
        disponibles: Math.max(0, total - usadasEnPool),
        limite: todas.length < total,
      },
      ips: libres.slice(0, 512),
      actual: actual || null,
    });
  } catch (error) {
    next(error);
  }
}


const ALFABETO_PORTAL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function clavePortal() {
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes).map((byte) => ALFABETO_PORTAL[byte % ALFABETO_PORTAL.length]).join('');
}

/** POST /clientes/:id/portal — habilita, restablece o quita el acceso al portal. */
async function portal(req, res, next) {
  try {
    const cliente = await Client.findById(req.params.id).select('+portalPasswordHash');
    if (!cliente) throw crearError(404, 'El cliente no existe.');
    const actor = req.usuario ? req.usuario.username : 'admin';
    if (req.body.accion === 'deshabilitar') {
      cliente.portalEnabled = false;
      cliente.portalPasswordHash = undefined;
      await cliente.save();
      req.flash('exito', 'Acceso al portal deshabilitado.');
      return res.redirect('/clientes/' + cliente._id);
    }
    if (cliente.portalPasswordHash && !puedeEditar(req.usuario, 'finanzas.facturas')) {
      throw crearError(403, 'Solo un administrador o finanzas pueden restablecer una clave de portal existente.');
    }
    const clave = clavePortal();
    cliente.portalEnabled = true;
    cliente.portalPasswordHash = hashPassword(clave);
    await cliente.save();
    await registrar({
      module: 'commercial',
      entity: 'Client',
      entityId: cliente._id,
      action: 'update',
      description: 'Acceso al portal generado para ' + cliente.clientCode + '.',
      actor,
    });
    req.flash('exito', 'Portal habilitado. Código: ' + cliente.clientCode + ' · Clave temporal: ' + clave + '. Anótala: no se vuelve a mostrar.');
    res.redirect('/clientes/' + cliente._id);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect('/clientes/' + req.params.id);
    }
    next(error);
  }
}

module.exports = {
  portal,
  index,
  show,
  formNuevo,
  crear,
  formEditar,
  actualizar,
  eliminar,
  verificarEstados,
  formServicio,
  crearServicio,
  actualizarServicio,
  cambiarPlan,
  cortar,
  restaurar,
  apiIpsPool,
};
