const crypto = require('node:crypto');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const Router = require('../models/Router');
const IpPool = require('../models/IpPool');
const Sale = require('../models/Sale');
const Settings = require('../models/Settings');
const Subscription = require('../models/Subscription');
const InventoryItem = require('../models/InventoryItem');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const billingService = require('./billingService');
const inventoryService = require('./inventoryService');
const routerService = require('./routerService');
const planService = require('./planService');
const reportService = require('./reportService');
const { registrar } = require('./auditService');
const { cifrar, descifrar } = require('./cryptoService');
const { crearError } = require('../utils/errors');
const { redondear } = require('../utils/money');
const { sumarIntervalo, fechaLocal } = require('../utils/dates');
const { primeraIpLibre, esIpValida, ipEnCidr } = require('../utils/ip');
const { TIPOS_CONEXION } = require('../config/constants');
const { normalizarMac } = require('../utils/mac');

/* Una instalación normal tarda segundos; 30 min evita robos de bloqueo por
   un router muy lento sin dejar la venta bloqueada para siempre. */
const VENCIMIENTO_BLOQUEO_MS = 30 * 60 * 1000;

/** Calcula los importes de una venta a partir de sus líneas. */
function calcularTotales({ items = [], installationCost = 0, taxRatePercent = 0 } = {}) {
  const lineas = (items || []).map((item) => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
    return {
      itemId: item.itemId || item.inventoryItemId,
      name: item.name || '',
      tracking: item.tracking || 'bulk',
      unit: item.unit || 'unidad',
      quantity,
      unitPrice: redondear(unitPrice),
      amount: redondear(quantity * unitPrice),
      serials: (item.serials || []).filter(Boolean).map((s) => String(s).toUpperCase()),
    };
  });

  const materialsTotal = redondear(lineas.reduce((suma, linea) => suma + linea.amount, 0));
  const instalacion = redondear(Math.max(0, Number(installationCost) || 0));
  const subtotal = redondear(materialsTotal + instalacion);
  const tasa = Number(taxRatePercent) || 0;
  if (tasa < 0 || tasa > 100) throw crearError(422, 'El IVA debe estar entre 0 y 100 %.');
  const tax = redondear(subtotal * (tasa / 100));
  return {
    lines: lineas,
    materialsTotal,
    installationCost: instalacion,
    subtotal,
    taxRatePercent: tasa,
    tax,
    total: redondear(subtotal + tax),
  };
}

function generarPassword(longitud = 10) {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(longitud);
  return Array.from(bytes, (byte) => alfabeto[byte % alfabeto.length]).join('');
}

/** Nombre PPPoE único a partir del código de cliente. */
async function generarUsuarioPppoe(cliente) {
  const base = String(cliente.clientCode || 'cliente').toLowerCase().replace(/[^a-z0-9]+/g, '');
  let candidato = base;
  let intento = 0;
  // eslint-disable-next-line no-await-in-loop
  while (await Subscription.exists({ 'serviceConfig.pppoeUsername': candidato })) {
    intento += 1;
    candidato = `${base}${intento}`;
  }
  return candidato;
}

/** Devuelve la primera IP libre del pool, excluyendo las ya asignadas. */
async function siguienteIp(pool) {
  if (!pool) return '';
  const [servicios, ventas] = await Promise.all([
    Subscription.find({ 'serviceConfig.ipPoolId': pool._id, 'serviceConfig.ipAddress': { $gt: '' } })
      .select('serviceConfig.ipAddress')
      .lean(),
    Sale.find({ status: 'waiting', 'service.ipAddress': { $gt: '' } })
      .select('service.ipAddress')
      .lean(),
  ]);
  const usadas = new Set([
    ...servicios.map((s) => s.serviceConfig.ipAddress),
    ...ventas.map((v) => v.service.ipAddress),
  ]);
  return primeraIpLibre(pool.cidr, usadas) || '';
}

/** Crea una venta en estado `waiting`, sin tocar el inventario. */
async function crearVenta(datos = {}, { actor = 'admin' } = {}) {
  const settings = await Settings.getSingleton();
  const totales = calcularTotales({
    ...datos,
    taxRatePercent: settings.billing.taxEnabled === false ? 0 : datos.taxRatePercent,
  });
  if (!totales.lines.length && totales.installationCost <= 0) {
    throw crearError(422, 'Agrega al menos un artículo o el costo de instalación.');
  }

  const servicio = { ...(datos.service || {}) };
  const password = String(servicio.pppoePassword || '').trim().slice(0, 80);
  delete servicio.pppoePassword;
  if (password) servicio.pppoePasswordEnc = cifrar(password);
  servicio.connectionType = TIPOS_CONEXION.includes(servicio.connectionType) ? servicio.connectionType : 'pppoe';
  servicio.pppoeUsername = String(servicio.pppoeUsername || '').trim().toLowerCase();
  servicio.ipAddress = String(servicio.ipAddress || '').trim();
  const macRaw = String(servicio.macAddress || '').trim().toUpperCase();
  const mac = normalizarMac(macRaw);
  const macAuth = servicio.macAuthEnabled === true || servicio.macAuthEnabled === 'on' || servicio.macAuthEnabled === 'true';
  servicio.macAddress = mac;
  servicio.macAuthEnabled = macAuth;
  if (macRaw && !mac) throw crearError(422, 'La MAC no es válida. Usa el formato AA:BB:CC:DD:EE:FF.');
  if (macAuth && !mac) throw crearError(422, 'La autenticación por MAC necesita una MAC.');
  if (macAuth && mac) {
    const usada = (await Subscription.exists({ 'serviceConfig.macAuthEnabled': true, 'serviceConfig.macAddress': mac }))
      || (await Sale.exists({ status: 'waiting', 'service.macAuthEnabled': true, 'service.macAddress': mac }));
    if (usada) throw crearError(422, 'La MAC ya está autenticada en otro servicio o venta.');
  }

  const router = servicio.routerId ? await Router.findOne({ _id: servicio.routerId, active: true }).lean() : null;
  if (servicio.routerId && !router) throw crearError(422, 'El router seleccionado no existe o está inactivo.');

  const plan = servicio.planId ? await Plan.findOne({ _id: servicio.planId, active: true }) : null;
  if (servicio.planId && !plan) throw crearError(422, 'El plan seleccionado no existe o está inactivo.');
  if (plan && router && !planService.routerPermitido(plan, router)) {
    throw crearError(422, 'El plan no se puede usar en el router seleccionado.');
  }

  const pool = servicio.ipPoolId ? await IpPool.findById(servicio.ipPoolId).lean() : null;
  if (servicio.ipPoolId && !pool) throw crearError(422, 'El pool seleccionado no existe.');
  if (pool && router && String(pool.routerId) !== String(servicio.routerId)) {
    throw crearError(422, 'El pool no pertenece al router seleccionado.');
  }
  if (servicio.ipAddress && (!pool || !esIpValida(servicio.ipAddress) || !ipEnCidr(servicio.ipAddress, pool.cidr))) {
    throw crearError(422, 'La IP no pertenece al pool seleccionado.');
  }
  if (
    servicio.ipAddress &&
    ((await Subscription.exists({ 'serviceConfig.ipAddress': servicio.ipAddress })) ||
      (await Sale.exists({ status: 'waiting', 'service.ipAddress': servicio.ipAddress })))
  ) {
    throw crearError(422, 'La IP seleccionada ya está asignada a otro servicio o venta.');
  }

  // Validación informativa: no descuenta stock hasta instalar.
  await inventoryService.validarConsumo(totales.lines);

  const venta = await Sale.create({
    code: await Sale.siguienteCodigo(),
    status: 'waiting',
    customer: datos.customer || {},
    service: servicio,
    items: totales.lines,
    materialsTotal: totales.materialsTotal,
    installationCost: totales.installationCost,
    subtotal: totales.subtotal,
    taxRatePercent: totales.taxRatePercent,
    tax: totales.tax,
    total: totales.total,
    scheduledAt: datos.scheduledAt ? fechaLocal(datos.scheduledAt) : undefined,
    technicianId: datos.technicianId || null,
    promoterId: datos.promoterId || null,
    notes: String(datos.notes || '').slice(0, 500),
  });

  await registrar({
    module: 'commercial',
    entity: 'Sale',
    entityId: venta._id,
    action: 'create',
    description: `Venta ${venta.code} registrada en espera por ${venta.clienteNombre || 'cliente nuevo'}.`,
    changes: { after: { code: venta.code, total: venta.total, status: venta.status } },
    actor,
  });

  return venta;
}

/** Busca un cliente existente por email o identificación para no duplicarlo. */
async function clienteExistente(customer = {}) {
  const condiciones = [];
  if (customer.email) condiciones.push({ email: String(customer.email).toLowerCase() });
  if (customer.taxId) condiciones.push({ taxId: String(customer.taxId).trim() });
  if (!condiciones.length) return null;
  return Client.findOne({ $or: condiciones });
}

/** Instala una venta: crea cliente, servicio, aprovisiona, descuenta stock y factura. */
async function instalar(ventaId, { actor = 'admin' } = {}) {
  const previa = await Sale.findById(ventaId).select('service status').lean();
  if (!previa) throw crearError(404, 'La venta no existe.');
  const servicioPrevio = previa.service || {};
  const faltantes = [];
  if (!servicioPrevio.planId) faltantes.push('plan');
  if (!servicioPrevio.routerId) faltantes.push('router');
  if (['static', 'dhcp'].includes(servicioPrevio.connectionType) && !servicioPrevio.ipAddress) faltantes.push('IP');
  if (faltantes.length) {
    throw crearError(422, `Completa el servicio antes de instalar: falta ${faltantes.join(', ')}.`);
  }

  const vencido = new Date(Date.now() - VENCIMIENTO_BLOQUEO_MS);
  /* Reclama la venta antes de tocar cliente, stock o router. */
  const venta = await Sale.findOneAndUpdate(
    {
      _id: ventaId,
      status: 'waiting',
      $or: [{ installStartedAt: null }, { installStartedAt: { $lt: vencido } }],
    },
    { $set: { installStartedAt: new Date() } },
    { new: true }
  ).select('+service.pppoePasswordEnc');
  if (!venta) {
    const existe = await Sale.findById(ventaId).select('status installStartedAt').lean();
    if (!existe) throw crearError(404, 'La venta no existe.');
    if (existe.status !== 'waiting') {
      throw crearError(422, 'Solo las ventas en espera pueden instalarse.');
    }
    throw crearError(409, 'La venta ya se está instalando en otra petición.');
  }

  // Si el IVA se desactivó después de crear la venta, se corrige antes de instalar.
  const ajustes = await Settings.getSingleton();
  if (ajustes.billing.taxEnabled === false && Number(venta.tax) > 0) {
    const totales = calcularTotales({
      items: venta.items,
      installationCost: venta.installationCost,
      taxRatePercent: 0,
    });
    venta.items = totales.lines;
    venta.materialsTotal = totales.materialsTotal;
    venta.subtotal = totales.subtotal;
    venta.taxRatePercent = 0;
    venta.tax = 0;
    venta.total = totales.total;
  }

  const clienteData = venta.customer || {};
  if (!clienteData.firstName || !clienteData.lastName) {
    throw crearError(422, 'La venta no tiene el nombre del cliente.');
  }

  let cliente = null;
  let clienteNuevo = false;
  let subscription = null;
  let subPrevia = null;
  let factura = null;
  let consumidos = [];
  let ventaGuardada = false;
  let facturaReusada = false;

  try {
    cliente = venta.clientId ? await Client.findById(venta.clientId) : await clienteExistente(clienteData);
    if (!cliente) {
    cliente = await Client.create({
      clientCode: await Client.siguienteCodigo(),
      firstName: clienteData.firstName,
      lastName: clienteData.lastName,
      taxId: clienteData.taxId || '',
      email: clienteData.email || '',
      phone: clienteData.phone || '',
      address: {
        street: clienteData.address || '',
        city: clienteData.city || '',
        state: clienteData.state || '',
      },
      status: 'active',
      notes: `Alta desde la venta ${venta.code}.`,
    });
    clienteNuevo = true;
  }

  venta.clientId = cliente._id;
  await venta.save();

  subPrevia = await Subscription.findOne({ saleId: venta._id }).select('+serviceConfig.pppoePasswordEnc');
  if (!subPrevia && await Subscription.findOne({ clientId: cliente._id })) {
    throw crearError(422, `${cliente.fullName} ya tiene un servicio contratado.`);
  }

  const plan = await Plan.findById(venta.service?.planId);
  if (!plan || !plan.active) throw crearError(422, 'La venta no tiene un plan activo asignado.');

  const router = venta.service?.routerId
    ? await Router.findById(venta.service.routerId)
    : await Router.findOne({ active: true }).sort({ createdAt: 1 });
  if (!planService.routerPermitido(plan, router)) {
    throw crearError(422, 'El plan de la venta no se puede usar en el router seleccionado.');
  }
  const pool = venta.service?.ipPoolId ? await IpPool.findById(venta.service.ipPoolId) : null;
  const tipo = subPrevia ? subPrevia.serviceConfig.connectionType : (venta.service?.connectionType || 'pppoe');

  let usuario = subPrevia
    ? subPrevia.serviceConfig.pppoeUsername
    : (venta.service?.pppoeUsername || (await generarUsuarioPppoe(cliente)));
  const password = subPrevia
    ? (subPrevia.serviceConfig.pppoePasswordEnc ? descifrar(subPrevia.serviceConfig.pppoePasswordEnc) : '')
    : (venta.service?.pppoePasswordEnc ? descifrar(venta.service.pppoePasswordEnc) : generarPassword());
  let ip = subPrevia
    ? String(subPrevia.serviceConfig.ipAddress || '')
    : String(venta.service?.ipAddress || (pool ? await siguienteIp(pool) : '') || '').trim();

  if (!subPrevia && ['static', 'dhcp'].includes(tipo) && !ip) {
    if (pool) throw crearError(422, 'El pool seleccionado no tiene direcciones libres.');
    throw crearError(422, 'Debes indicar una dirección IP para este tipo de conexión.');
  }
  if (!subPrevia && plan.trafficMode === 'address_list' && !ip) {
    throw crearError(422, 'Los planes por address list necesitan una IP fija.');
  }

  /* MAC: la del servicio o, si no se escribió, la del serial que se instala. */
  let mac = subPrevia ? normalizarMac(subPrevia.serviceConfig.macAddress) : normalizarMac(venta.service?.macAddress);
  if (!mac) {
    const seriales = (venta.items || []).flatMap((item) => item.serials || []).map(String);
    if (seriales.length) {
      const inventario = await InventoryItem.find({ 'serials.serial': { $in: seriales } })
        .select('serials')
        .lean();
      const encontrado = inventario
        .flatMap((item) => item.serials || [])
        .find((serial) => seriales.includes(serial.serial) && serial.mac);
      mac = normalizarMac(encontrado?.mac);
    }
  }
  const macAuth = subPrevia ? Boolean(subPrevia.serviceConfig.macAuthEnabled) : Boolean(venta.service?.macAuthEnabled);
  if (!subPrevia && macAuth && mac && await Subscription.exists({ 'serviceConfig.macAuthEnabled': true, 'serviceConfig.macAddress': mac })) {
    throw crearError(422, 'La MAC de esta venta ya esta autenticada en un servicio. Edita la venta con otra MAC antes de instalar.');
  }
  if (!subPrevia && macAuth && !mac) throw crearError(422, 'La venta pide autenticación por MAC pero no tiene una MAC.');

  const ahora = new Date();
  if (subPrevia) {
    subscription = subPrevia;
  } else {
    for (let intento = 0; intento < 3; intento += 1) {
      subscription = new Subscription({
        clientId: cliente._id,
        saleId: venta._id,
        planId: plan._id,
        planSnapshot: plan.snapshot,
        serviceConfig: {
          connectionType: tipo,
          ipAddress: ip,
          macAddress: mac,
          macAuthEnabled: macAuth,
          pppoeUsername: tipo === 'pppoe' ? usuario : '',
          pppoePasswordEnc: tipo === 'pppoe' ? cifrar(password) : '',
          routerId: router?._id || null,
          ipPoolId: pool?._id || null,
          queueName: plan.trafficMode === 'address_list'
            ? ''
            : routerService.nombreCola({ serviceConfig: { pppoeUsername: tipo === 'pppoe' ? usuario : '' }, clientId: cliente }),
          provisioningState: 'none',
        },
        status: 'active',
        currentPeriodStart: ahora,
        currentPeriodEnd: sumarIntervalo(ahora, plan.billingInterval),
        installedAt: ahora,
        notes: venta.notes || '',
      });

      try {
        await subscription.save();
        break;
      } catch (error) {
        if (error.code !== 11000 || intento === 2) throw error;
        const campo = Object.keys(error.keyPattern || {})[0];
        if (campo === 'serviceConfig.pppoeUsername' && !venta.service?.pppoeUsername) {
          usuario = await generarUsuarioPppoe(cliente);
          continue;
        }
        if (campo === 'serviceConfig.ipAddress' && !venta.service?.ipAddress && pool) {
          ip = (await siguienteIp(pool)) || '';
          if (!ip) throw crearError(422, 'El pool seleccionado no tiene direcciones libres.');
          continue;
        }
        throw error;
      }
    }
    venta.subscriptionId = subscription._id;
    await venta.save();
  }

  // 1) Descontar existencias una sola vez por venta (los serializados pasan a `installed`).
  const stockPrevio = await InventoryItem.exists({
    movements: { $elemMatch: { saleId: venta._id, type: { $in: ['instalacion', 'venta'] } } },
  });
  if (!stockPrevio) {
    consumidos = await inventoryService.consumirLineas(venta.items, {
      clientId: cliente._id,
      saleId: venta._id,
      actor,
      tipo: 'instalacion',
      reason: `Instalación de la venta ${venta.code}`,
    });
  }

  // 2) Generar la factura de instalación (no corta el servicio).
  factura = await Invoice.findOne({ saleId: venta._id, type: 'installation', status: { $ne: 'void' } });
  if (factura) {
    facturaReusada = true;
  } else {
    const lineasFactura = venta.items.map((item) => ({
      description: `${item.name}${item.serials?.length ? ` (${item.serials.join(', ')})` : ''}`,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      inventoryItemId: item.itemId,
      serials: item.serials,
    }));
    if (venta.installationCost > 0) {
      lineasFactura.unshift({
        description: `Instalación del servicio ${plan.name}`,
        quantity: 1,
        unitPrice: venta.installationCost,
      });
    }

    factura = await billingService.crearFactura({
      clientId: cliente._id,
      subscriptionId: subscription._id,
      saleId: venta._id,
      lines: lineasFactura,
      taxRatePercent: venta.taxRatePercent,
      type: 'installation',
      affectsService: false,
      notes: `Instalación generada por la venta ${venta.code}.`,
      actor,
    });
  }

  // 3) Aprovisionar en el router seleccionado (real o simulado).
  let aprovisionamiento = null;
  try {
    aprovisionamiento = await routerService.aprovisionar(subscription, { accion: 'create', actor });
  } catch (error) {
    subscription.serviceConfig.provisioningState = 'error';
    subscription.serviceConfig.lastProvisionResult = error.message;
    await subscription.save();
  }

  if (!aprovisionamiento || !aprovisionamiento.ok) {
    const detalle = (aprovisionamiento?.resultados || []).find((resultado) => !resultado.ok)?.result
      || aprovisionamiento?.salida
      || subscription.serviceConfig.lastProvisionResult
      || 'sin detalle';
    await routerService.aprovisionar(subscription, { accion: 'delete', actor }).catch(() => null);
    throw crearError(
      502,
      `El router rechazó el aprovisionamiento: ${detalle}. La venta sigue en espera; corrige el router y reintenta.`
    );
  }

  venta.status = 'installed';
  venta.clientId = cliente._id;
  venta.subscriptionId = subscription._id;
  venta.invoiceId = factura._id;
  venta.installedAt = ahora;
  venta.service.ipAddress = ip;
  venta.service.macAddress = mac;
  venta.service.macAuthEnabled = macAuth;
  venta.service.pppoeUsername = tipo === 'pppoe' ? usuario : '';
  await venta.save();
  ventaGuardada = true;

  // El reporte diario de instalaciones se crea solo; su zona se asigna después.
  try {
    const tecnico = venta.technicianId
      ? await User.findById(venta.technicianId).select('name').lean()
      : null;
    await reportService.crearReporteInstalacion({
      saleId: venta._id,
      clientId: cliente._id,
      subscriptionId: subscription._id,
      clientName: cliente.fullName,
      planName: plan.name,
      technician: tecnico?.name || '',
      technicianId: venta.technicianId || null,
      installedAt: ahora,
    });
  } catch (error) {
    console.error('âš ï¸  No se pudo crear el reporte de instalación:', error.message);
  }

  await registrar({
    module: 'commercial',
    entity: 'Sale',
    entityId: venta._id,
    action: 'install',
    description: `Venta ${venta.code} instalada: ${cliente.fullName} (${cliente.clientCode}), plan ${plan.name}.`,
    changes: {
      after: {
        clientId: cliente._id,
        clienteNuevo,
        subscriptionId: subscription._id,
        invoiceId: factura._id,
        inventario: consumidos.map((c) => `${c.name} ×${c.quantity}`),
        aprovisionamiento: aprovisionamiento?.ok ? 'ok' : 'error',
      },
    },
    actor,
  });

  return {
    venta,
    cliente,
    clienteNuevo,
    subscription,
    factura,
    password,
    aprovisionamiento,
    consumidos,
  };
  } catch (error) {
    if (!ventaGuardada) {
      if (factura && !facturaReusada) await Invoice.findByIdAndDelete(factura._id).catch(() => null);
      if (consumidos.length) {
        await inventoryService.devolverLineas(consumidos, {
          saleId: venta._id,
          actor,
          reason: `Reversión por error al instalar ${venta.code}`,
        }).catch(() => null);
      }
      if (subscription && !subPrevia) await subscription.deleteOne().catch(() => null);
      if (clienteNuevo && cliente) await Client.deleteOne({ _id: cliente._id }).catch(() => null);
      await Sale.updateOne(
        { _id: venta._id, status: 'waiting' },
        { $set: { installStartedAt: null } }
      ).catch(() => null);
    }
    throw error;
  }
}

/** Cancela una venta en espera sin tocar inventario ni emitir factura. */
async function cancelar(ventaId, { reason = '', actor = 'admin' } = {}) {
  const vencido = new Date(Date.now() - VENCIMIENTO_BLOQUEO_MS);
  const venta = await Sale.findOneAndUpdate(
    {
      _id: ventaId,
      status: 'waiting',
      $or: [{ installStartedAt: null }, { installStartedAt: { $lt: vencido } }],
    },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: String(reason || 'Cancelada por el operador.').slice(0, 300),
        installStartedAt: null,
      },
    },
    { new: true }
  );
  if (!venta) {
    const existe = await Sale.findById(ventaId).select('status installStartedAt').lean();
    if (!existe) throw crearError(404, 'La venta no existe.');
    if (existe.status === 'waiting') {
      throw crearError(409, 'La venta se está instalando; espera a que termine.');
    }
    throw crearError(422, 'Solo se pueden cancelar ventas en espera. Una venta instalada se anula desde su factura.');
  }

  await registrar({
    module: 'commercial',
    entity: 'Sale',
    entityId: venta._id,
    action: 'cancel',
    description: `Venta ${venta.code} cancelada: ${venta.cancelReason}.`,
    changes: { before: { status: 'waiting' }, after: { status: 'cancelled' } },
    actor,
  });

  return venta;
}

/** Devuelve artículos con stock disponible para el formulario de venta. */
async function articulosDisponibles() {
  const items = await InventoryItem.find({ active: true })
    .sort({ category: 1, name: 1 })
    .lean();
  /* `lean` no evalúa virtuales: se calcula el stock para la vista. */
  return items.map((item) => ({ ...item, stock: inventoryService.stockDisponible(item) }));
}

module.exports = {
  calcularTotales,
  generarPassword,
  generarUsuarioPppoe,
  siguienteIp,
  crearVenta,
  instalar,
  cancelar,
  articulosDisponibles,
};

