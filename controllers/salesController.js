const Sale = require('../models/Sale');
const Plan = require('../models/Plan');
const Router = require('../models/Router');
const IpPool = require('../models/IpPool');
const InventoryItem = require('../models/InventoryItem');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Settings = require('../models/Settings');
const salesService = require('../services/salesService');
const inventoryService = require('../services/inventoryService');
const planService = require('../services/planService');
const { registrar } = require('../services/auditService');
const { cifrar } = require('../services/cryptoService');
const { crearError, mensajeDeError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const { VENTAS_POR_PAGINA, ESTADOS_VENTA, TIPOS_CONEXION } = require('../config/constants');
const { escaparRegex } = require('../utils/strings');
const { ipEnCidr, esIpValida } = require('../utils/ip');
const { normalizarMac } = require('../utils/mac');

const MAPA_VENTA = {
  'customer.firstName': 'firstName',
  'customer.lastName': 'lastName',
  'customer.taxId': 'taxId',
  'customer.phone': 'phone',
  'customer.email': 'email',
  'customer.city': 'city',
  'customer.address': 'address',
  'customer.state': 'state',
  'service.planId': 'planId',
  'service.routerId': 'routerId',
  'service.ipPoolId': 'ipPoolId',
  'service.connectionType': 'connectionType',
  'service.pppoeUsername': 'pppoeUsername',
  'service.ipAddress': 'ipAddress',
  technicianId: 'technicianId',
  promoterId: 'promoterId',
  installationCost: 'installationCost',
  taxRatePercent: 'taxRatePercent',
};

function leerItems(body = {}) {
  const ids = [].concat(body.itemId || []);
  const cantidades = [].concat(body.quantity || []);
  const precios = [].concat(body.unitPrice || []);
  const seriales = [].concat(body.serials || []);
  return ids
    .map((id, indice) => ({
      itemId: id,
      quantity: Number(cantidades[indice]) || 1,
      unitPrice: precios[indice] === undefined || precios[indice] === '' ? undefined : Number(precios[indice]),
      serials: String(seriales[indice] || '').split(/[,;\s]+/).filter(Boolean),
    }))
    .filter((linea) => linea.itemId);
}

async function hidratarItems(lineas = []) {
  const items = await InventoryItem.find({ _id: { $in: lineas.map((l) => l.itemId) } }).lean();
  const mapa = new Map(items.map((i) => [String(i._id), i]));
  return lineas
    .filter((linea) => mapa.has(String(linea.itemId)))
    .map((linea) => {
      const item = mapa.get(String(linea.itemId));
      if (item.tracking === 'serial') {
        const disponibles = new Set(
          (item.serials || [])
            .filter((serial) => serial.status === 'available')
            .map((serial) => String(serial.serial).toUpperCase())
        );
        const elegidos = linea.serials.map((serial) => String(serial).toUpperCase());
        if (elegidos.length !== linea.quantity) {
          throw crearError(422, `Elige ${linea.quantity} serial(es) de ${item.name}.`);
        }
        const ajeno = elegidos.find((serial) => !disponibles.has(serial));
        if (ajeno) throw crearError(422, `El serial ${ajeno} no está disponible en ${item.name}.`);
        linea.serials = elegidos;
      }
      return {
        itemId: item._id,
        name: item.name,
        tracking: item.tracking,
        unit: item.unit,
        quantity: linea.quantity,
        unitPrice: linea.unitPrice === undefined ? item.price : linea.unitPrice,
        serials: linea.serials.map((s) => String(s).toUpperCase()),
      };
    });
}

async function catalogos() {
  const [planes, routers, pools, items, usuarios] = await Promise.all([
    Plan.find({ active: true }).sort({ price: 1 }).lean(),
    Router.find({ active: true }).sort({ name: 1 }).lean(),
    IpPool.find({ active: true }).populate('routerId').sort({ name: 1 }).lean(),
    InventoryItem.find({ active: true }).sort({ category: 1, name: 1 }),
    User.find({ active: true }).sort({ name: 1 }).select('name username role').lean(),
  ]);
  return { planes, routers, pools, items, usuarios };
}

/** GET /ventas */
async function index(req, res, next) {
  try {
    const { q = '', estado = '', page = 1 } = req.query;
    const consulta = {};
    if (ESTADOS_VENTA.includes(estado)) consulta.status = estado;
    if (q.trim()) {
      const regex = new RegExp(escaparRegex(q.trim()), 'i');
      consulta.$or = [{ code: regex }, { 'customer.firstName': regex }, { 'customer.lastName': regex }, { 'customer.email': regex }];
    }

    const total = await Sale.countDocuments(consulta);
    const paginas = Math.max(1, Math.ceil(total / VENTAS_POR_PAGINA));
    const actual = Math.min(Math.max(1, Number(page) || 1), paginas);

    const [ventas, resumen] = await Promise.all([
      Sale.find(consulta)
        .populate('clientId')
        .populate('service.planId')
        .sort({ createdAt: -1 })
        .skip((actual - 1) * VENTAS_POR_PAGINA)
        .limit(VENTAS_POR_PAGINA),
      Promise.all([
        Sale.countDocuments(),
        Sale.countDocuments({ status: 'waiting' }),
        Sale.countDocuments({ status: 'installed' }),
        Sale.countDocuments({ status: 'cancelled' }),
        Sale.aggregate([{ $match: { status: 'installed' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      ]),
    ]);

    res.render('sales/index', {
      titulo: 'Ventas e instalaciones',
      ventas,
      filtros: { q, estado },
      paginacion: { actual, paginas, total },
      resumen: {
        total: resumen[0],
        espera: resumen[1],
        instaladas: resumen[2],
        canceladas: resumen[3],
        facturado: resumen[4][0]?.total || 0,
      },
    });
  } catch (error) {
    next(error);
  }
}

/** GET /ventas/nueva */
async function formNuevo(req, res, next) {
  try {
    const cat = await catalogos();
    res.render('sales/form', {
      titulo: 'Nueva venta',
      venta: new Sale({ status: 'waiting', service: { connectionType: 'pppoe' } }),
      ...cat,
      modo: 'crear',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** POST /ventas */
async function crear(req, res, next) {
  try {
    const faltantes = {};
    if (!req.body.technicianId) faltantes.technicianId = 'Selecciona el técnico instalador.';
    if (!req.body.promoterId) faltantes.promoterId = 'Selecciona el promotor de la venta.';
    if (!faltantes.technicianId) {
      const tecnico = await User.findById(req.body.technicianId).select('active').lean();
      if (!tecnico || !tecnico.active) faltantes.technicianId = 'El técnico instalador no está activo.';
    }
    if (!faltantes.promoterId) {
      const promotor = await User.findById(req.body.promoterId).select('active').lean();
      if (!promotor || !promotor.active) faltantes.promoterId = 'El promotor no está activo.';
    }
    if (Object.keys(faltantes).length) {
      const error = crearError(422, 'Completa el técnico instalador y el promotor.');
      error.campos = faltantes;
      throw error;
    }
    const lineas = await hidratarItems(leerItems(req.body));
    const venta = await salesService.crearVenta({
      customer: {
        firstName: req.body.firstName || '',
        lastName: req.body.lastName || '',
        taxId: req.body.taxId || '',
        email: req.body.email || '',
        phone: req.body.phone || '',
        address: req.body.address || '',
        city: req.body.city || '',
        state: req.body.state || '',
      },
      service: {
        planId: req.body.planId || null,
        routerId: req.body.routerId || null,
        ipPoolId: req.body.ipPoolId || null,
        connectionType: TIPOS_CONEXION.includes(req.body.connectionType) ? req.body.connectionType : 'pppoe',
        pppoeUsername: req.body.pppoeUsername || '',
        pppoePassword: req.body.pppoePassword || '',
        ipAddress: req.body.ipAddress || '',
        macAddress: String(req.body.macAddress || '').trim().toUpperCase(),
        macAuthEnabled: req.body.macAuthEnabled === 'on' || req.body.macAuthEnabled === 'true',
      },
      items: lineas,
      installationCost: Number(req.body.installationCost) || 0,
      taxRatePercent: Number(req.body.taxRatePercent) || 0,
      scheduledAt: req.body.scheduledAt || undefined,
      technicianId: req.body.technicianId || null,
      promoterId: req.body.promoterId || null,
      notes: req.body.notes || '',
    });

    req.flash('exito', `Venta ${venta.code} registrada en espera. El inventario se descuenta al instalar.`);
    res.redirect(`/ventas/${venta._id}`);
  } catch (error) {
    if (error.status || error.name === 'ValidationError' || error.name === 'CastError') {
      const cat = await catalogos();
      const { lista, campos } = normalizarErrores(error, MAPA_VENTA);
      return res.status(error.status || 422).render('sales/form', {
        titulo: 'Nueva venta',
        venta: new Sale(req.body),
        ...cat,
        modo: 'crear',
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

/** GET /ventas/:id */
async function show(req, res, next) {
  try {
    const venta = await Sale.findById(req.params.id)
      .populate('clientId')
      .populate('service.planId')
      .populate('service.routerId')
      .populate('service.ipPoolId')
      .populate('invoiceId')
      .populate('subscriptionId')
      .populate('technicianId', 'name username role')
      .populate('promoterId', 'name username role');
    if (!venta) throw crearError(404, 'La venta no existe.');
    res.render('sales/show', {
      titulo: `${venta.code} · Venta`,
      venta,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /ventas/:id/instalar */
async function instalar(req, res, next) {
  try {
    const resultado = await salesService.instalar(req.params.id, {});
    req.flash(
      'exito',
      `Venta instalada. Cliente ${resultado.cliente.clientCode} y factura de instalación ${resultado.factura.invoiceNumber} creados.` +
        (resultado.password ? ` Contraseña PPPoE: ${resultado.password}` : '')
    );
    res.redirect(`/ventas/${req.params.id}`);
  } catch (error) {
    if (error.status || error.name === 'ValidationError' || error.code === 11000) {
      req.flash('error', mensajeDeError(error));
      return res.redirect(`/ventas/${req.params.id}`);
    }
    next(error);
  }
}

/** POST /ventas/:id/cancelar */
async function cancelar(req, res, next) {
  try {
    await salesService.cancelar(req.params.id, { reason: req.body.reason || '' });
    req.flash('exito', 'Venta cancelada. No se modificó el inventario.');
    res.redirect(`/ventas/${req.params.id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect(`/ventas/${req.params.id}`);
    }
    next(error);
  }
}

/** GET /ventas/:id/servicio/editar */
async function formServicio(req, res, next) {
  try {
    const venta = await Sale.findById(req.params.id)
      .populate('service.planId')
      .populate('service.routerId')
      .populate('service.ipPoolId');
    if (!venta) throw crearError(404, 'La venta no existe.');
    if (venta.status !== 'waiting' || venta.installStartedAt) {
      req.flash('error', 'Solo se puede modificar el servicio de una venta en espera.');
      return res.redirect(`/ventas/${venta._id}`);
    }
    const cat = await catalogos();
    res.render('sales/service-edit', {
      titulo: `Modificar servicio · ${venta.code}`,
      venta,
      ...cat,
      errores: [],
      erroresCampo: {},
    });
  } catch (error) {
    next(error);
  }
}

/** POST /ventas/:id/servicio/editar */
async function actualizarServicio(req, res, next) {
  try {
    const venta = await Sale.findById(req.params.id);
    if (!venta) throw crearError(404, 'La venta no existe.');
    if (venta.status !== 'waiting' || venta.installStartedAt) {
      req.flash('error', 'Solo se puede modificar el servicio de una venta en espera.');
      return res.redirect(`/ventas/${venta._id}`);
    }

    const plan = await Plan.findById(req.body.planId);
    if (!plan || !plan.active) {
      const error = crearError(422, 'El plan seleccionado no está disponible.');
      error.campos = { planId: 'Selecciona un plan activo.' };
      throw error;
    }
    const router = await Router.findOne({ _id: req.body.routerId, active: true });
    if (!router) {
      const error = crearError(422, 'El router seleccionado no existe o está inactivo.');
      error.campos = { routerId: 'Selecciona un router activo.' };
      throw error;
    }
    if (!planService.routerPermitido(plan, router)) {
      const error = crearError(422, 'El plan no se puede usar en el router seleccionado.');
      error.campos = plan.trafficMode === 'address_list'
        ? { planId: 'Este plan no está habilitado para el router elegido.' }
        : { routerId: 'El router no maneja este tipo de plan.' };
      throw error;
    }

    const pool = req.body.ipPoolId ? await IpPool.findById(req.body.ipPoolId) : null;
    if (req.body.ipPoolId && !pool) {
      const error = crearError(422, 'El pool de IP no existe.');
      error.campos = { ipPoolId: 'Selecciona un pool válido.' };
      throw error;
    }
    if (pool && String(pool.routerId) !== String(router._id)) {
      const error = crearError(422, 'El pool pertenece a otro router.');
      error.campos = { ipPoolId: 'Este pool pertenece a otro router.' };
      throw error;
    }

    const tipo = TIPOS_CONEXION.includes(req.body.connectionType) ? req.body.connectionType : 'pppoe';
    const requiereIp = ['static', 'dhcp'].includes(tipo) || plan.trafficMode === 'address_list';
    let ip = String(req.body.ipAddress || '').trim();
    if (!ip && pool) ip = (await salesService.siguienteIp(pool)) || '';
    if (requiereIp && !ip) {
      const error = crearError(422, 'Selecciona una IP para el servicio.');
      error.campos = { ipAddress: 'Selecciona una IP del pool.' };
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
        error.campos = { ipAddress: 'La IP debe pertenecer al pool.' };
        throw error;
      }
      if (
        await Sale.exists({ _id: { $ne: venta._id }, status: 'waiting', 'service.ipAddress': ip }) ||
        await Subscription.exists({ 'serviceConfig.ipAddress': ip })
      ) {
        const error = crearError(422, 'La IP ya está asignada a otro servicio o venta.');
        error.campos = { ipAddress: 'Elige otra IP disponible.' };
        throw error;
      }
    }

    const usuario = String(req.body.pppoeUsername || venta.service?.pppoeUsername || '').trim().toLowerCase();
    if (tipo === 'pppoe' && !usuario) {
      const error = crearError(422, 'El usuario PPPoE es obligatorio.');
      error.campos = { pppoeUsername: 'Escribe un usuario PPPoE.' };
      throw error;
    }
    if (usuario && await Sale.exists({ _id: { $ne: venta._id }, status: 'waiting', 'service.pppoeUsername': usuario })) {
      const error = crearError(422, 'El usuario PPPoE ya está en uso.');
      error.campos = { pppoeUsername: 'Elige otro usuario PPPoE.' };
      throw error;
    }

    if (!venta.service) venta.service = {};
    venta.service.planId = plan._id;
    venta.service.routerId = router._id;
    venta.service.ipPoolId = pool?._id || null;
    venta.service.connectionType = tipo;
    venta.service.ipAddress = ip;
    venta.service.pppoeUsername = tipo === 'pppoe' ? usuario : '';
    const macRaw = String(req.body.macAddress || '').trim().toUpperCase();
    const mac = normalizarMac(macRaw);
    const macAuth = req.body.macAuthEnabled === 'on' || req.body.macAuthEnabled === 'true';
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
      const usada = (await Subscription.exists({ 'serviceConfig.macAuthEnabled': true, 'serviceConfig.macAddress': mac }))
        || (await Sale.exists({ _id: { $ne: venta._id }, status: 'waiting', 'service.macAuthEnabled': true, 'service.macAddress': mac }));
      if (usada) {
        const error = crearError(422, 'La MAC ya está autenticada en otro servicio o venta.');
        error.campos = { macAddress: `La MAC ${mac} ya está asignada.` };
        throw error;
      }
    }
    venta.service.macAddress = mac;
    venta.service.macAuthEnabled = macAuth;
    if (tipo === 'pppoe' && req.body.pppoePassword) {
      venta.service.pppoePasswordEnc = cifrar(req.body.pppoePassword);
    }
    await venta.save();

    await registrar({
      module: 'commercial',
      entity: 'Sale',
      entityId: venta._id,
      action: 'update',
      description: `Servicio de la venta ${venta.code} modificado antes de instalar.`,
      changes: { after: { plan: plan.name, router: router.name, ip, tipo } },
    });
    req.flash('exito', 'Servicio de la venta actualizado.');
    res.redirect(`/ventas/${venta._id}`);
  } catch (error) {
    if (error.status || error.name === 'ValidationError' || error.code === 11000) {
      const venta = await Sale.findById(req.params.id)
        .populate('service.planId')
        .populate('service.routerId')
        .populate('service.ipPoolId');
      if (!venta) return next(error);
      const cat = await catalogos();
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('sales/service-edit', {
        titulo: `Modificar servicio · ${venta?.code || ''}`,
        venta,
        ...cat,
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

/** GET /ventas/:id/materiales/editar */
async function formMateriales(req, res, next) {
  try {
    const venta = await Sale.findById(req.params.id);
    if (!venta) throw crearError(404, 'La venta no existe.');
    if (venta.status !== 'waiting' || venta.installStartedAt) {
      req.flash('error', 'Solo se puede modificar el costo o los materiales de una venta en espera.');
      return res.redirect(`/ventas/${venta._id}`);
    }
    const items = await salesService.articulosDisponibles();
    res.render('sales/materials-edit', {
      titulo: `Costo y materiales · ${venta.code}`,
      venta,
      items,
      lineas: venta.items || [],
      errores: [],
      erroresCampo: {},
    });
  } catch (error) {
    next(error);
  }
}

/** POST /ventas/:id/materiales/editar */
async function actualizarMateriales(req, res, next) {
  try {
    const venta = await Sale.findById(req.params.id);
    if (!venta) throw crearError(404, 'La venta no existe.');
    if (venta.status !== 'waiting' || venta.installStartedAt) {
      req.flash('error', 'Solo se puede modificar el costo o los materiales de una venta en espera.');
      return res.redirect(`/ventas/${venta._id}`);
    }

    const lineas = await hidratarItems(leerItems(req.body));
    const settings = await Settings.getSingleton();
    const totales = salesService.calcularTotales({
      items: lineas,
      installationCost: req.body.installationCost,
      taxRatePercent: settings.billing.taxEnabled === false ? 0 : req.body.taxRatePercent,
    });
    if (!totales.lines.length && totales.installationCost <= 0) {
      throw crearError(422, 'Agrega al menos un artículo o el costo de instalación.');
    }
    await inventoryService.validarConsumo(totales.lines);

    venta.items = totales.lines;
    venta.materialsTotal = totales.materialsTotal;
    venta.installationCost = totales.installationCost;
    venta.subtotal = totales.subtotal;
    venta.taxRatePercent = totales.taxRatePercent;
    venta.tax = totales.tax;
    venta.total = totales.total;
    venta.notes = req.body.notes || '';
    await venta.save();

    await registrar({
      module: 'commercial',
      entity: 'Sale',
      entityId: venta._id,
      action: 'update',
      description: `Costo y materiales de la venta ${venta.code} modificados antes de instalar.`,
      changes: { after: { installationCost: venta.installationCost, total: venta.total, items: venta.items.length } },
    });
    req.flash('exito', 'Costo y materiales de la venta actualizados.');
    res.redirect(`/ventas/${venta._id}`);
  } catch (error) {
    if (error.status || error.name === 'ValidationError' || error.code === 11000) {
      const venta = await Sale.findById(req.params.id);
      if (!venta) return next(error);
      const items = await salesService.articulosDisponibles();
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('sales/materials-edit', {
        titulo: `Costo y materiales · ${venta?.code || ''}`,
        venta,
        items,
        lineas: leerItems(req.body),
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

module.exports = {
  index,
  formNuevo,
  crear,
  show,
  instalar,
  cancelar,
  formServicio,
  actualizarServicio,
  formMateriales,
  actualizarMateriales,
};

