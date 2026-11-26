const mongoose = require('mongoose');
const Settings = require('../models/Settings');
const Subscription = require('../models/Subscription');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Sale = require('../models/Sale');
const InventoryItem = require('../models/InventoryItem');
const firewallService = require('./firewallService');
const inventoryService = require('./inventoryService');
const { registrar } = require('./auditService');
const { redondear } = require('../utils/money');
const { sumarDias, sumarIntervalo, inicioDelDia, formatearFecha } = require('../utils/dates');
const { crearError } = require('../utils/errors');
const { ETIQUETAS_ESTADO, MONEDAS_PAGO, METODOS_PAGO_BS, METODOS_PAGO_USD } = require('../config/constants');

const ESTADOS_PENDIENTES = ['open', 'overdue'];

function descuentoAplicado(subtotal, discountType = 'none', discount = 0) {
  const valor = Math.max(0, Number(discount) || 0);
  if (discountType === 'percent') {
    return redondear(Math.min(subtotal, subtotal * (Math.min(valor, 100) / 100)));
  }
  if (discountType === 'amount') {
    return redondear(Math.min(subtotal, valor));
  }
  return 0;
}

/**
 * Calcula subtotal, descuento, base imponible, IVA y total.
 * El IVA se aplica después del descuento y puede venir del plan o de la factura.
 */
function importes(precio, taxRate, { discountType = 'none', discount = 0 } = {}) {
  const subtotal = redondear(precio);
  const discountAmount = descuentoAplicado(subtotal, discountType, discount);
  const taxBase = redondear(subtotal - discountAmount);
  const tax = redondear(taxBase * (Number(taxRate) || 0));
  const total = redondear(taxBase + tax);
  return { subtotal, discountAmount, taxBase, tax, total };
}

function clavePeriodo(subscriptionId, periodStart) {
  return `${String(subscriptionId)}:${new Date(periodStart).toISOString()}`;
}

/** Reserva el siguiente consecutivo de factura de forma atómica. */
async function siguienteNumeroFactura(settings = null) {
  const actualizada = await Settings.findOneAndUpdate(
    { key: 'system' },
    { $inc: { 'billing.nextInvoiceNumber': 1 } },
    { new: true }
  );
  const consecutivo = Math.max(1, Number(actualizada?.billing?.nextInvoiceNumber || 1) - 1);
  const prefijo = settings?.billing?.invoicePrefix || actualizada?.billing?.invoicePrefix || 'INV';
  return `${prefijo}-${String(consecutivo).padStart(6, '0')}`;
}

/**
 * Crea una factura manual, de venta o de instalación.
 * Estas facturas no afectan al servicio salvo que se indique lo contrario.
 */
async function crearFactura({
  _id = null,
  clientId,
  subscriptionId = null,
  saleId = null,
  lines = [],
  taxRatePercent = 0,
  discountType = 'none',
  discount = 0,
  dueDate = null,
  notes = '',
  type = 'other',
  affectsService = false,
  issueDate = new Date(),
  actor = 'admin',
} = {}) {
  if (!clientId) throw crearError(422, 'La factura necesita un cliente.');
  if (subscriptionId) {
    const suscripcion = await Subscription.findById(subscriptionId).select('clientId').lean();
    if (!suscripcion) throw crearError(422, 'La suscripción indicada no existe.');
    if (String(suscripcion.clientId) !== String(clientId)) {
      throw crearError(422, 'La suscripción no pertenece al cliente de la factura.');
    }
  }
  const settings = await Settings.getSingleton();

  const idsInventario = [...new Set((lines || []).map((linea) => linea.inventoryItemId).filter(Boolean))];
  const inventario = idsInventario.length
    ? await InventoryItem.find({ _id: { $in: idsInventario } }).select('cost').lean()
    : [];
  const costos = new Map(inventario.map((item) => [String(item._id), Number(item.cost) || 0]));

  const normalizadas = (lines || [])
    .map((linea) => {
      const quantity = Number(linea.quantity) || 0;
      const unitPrice = redondear(Number(linea.unitPrice) || 0);
      return {
        description: String(linea.description || '').trim().slice(0, 200),
        quantity,
        unitPrice,
        amount: redondear(quantity * unitPrice),
        cost: linea.inventoryItemId ? redondear(costos.get(String(linea.inventoryItemId)) || 0) : 0,
        inventoryItemId: linea.inventoryItemId || null,
        serials: linea.serials || [],
      };
    })
    .filter((linea) => linea.description && linea.quantity > 0);

  if (!normalizadas.length) throw crearError(422, 'La factura debe tener al menos una línea válida.');

  const tasa = settings.billing.taxEnabled === false ? 0 : Number(taxRatePercent);
  if (!Number.isFinite(tasa) || tasa < 0 || tasa > 100) throw crearError(422, 'El IVA debe estar entre 0 y 100 %.');

  const tipo = ['none', 'percent', 'amount'].includes(discountType) ? discountType : 'none';
  const valorDescuento = tipo === 'none' ? 0 : Number(discount) || 0;
  if (tipo === 'percent' && valorDescuento > 100) throw crearError(422, 'El descuento porcentual no puede superar 100 %.');

  const subtotal = redondear(normalizadas.reduce((suma, linea) => suma + linea.amount, 0));
  if (tipo === 'amount' && valorDescuento > subtotal) throw crearError(422, 'El descuento no puede superar el subtotal.');

  const calculado = importes(subtotal, redondear(tasa) / 100, { discountType: tipo, discount: valorDescuento });
  const invoiceNumber = await siguienteNumeroFactura(settings);
  const emision = issueDate instanceof Date && !Number.isNaN(issueDate.getTime()) ? issueDate : new Date();
  let vencimiento;
  if (dueDate) {
    vencimiento = new Date(`${String(dueDate).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(vencimiento.getTime())) throw crearError(422, 'La fecha de vencimiento no es válida.');
  } else {
    vencimiento = sumarDias(emision, settings.billing.dueDays);
  }

  const factura = await Invoice.create({
    ...(_id ? { _id } : {}),
    invoiceNumber,
    clientId,
    subscriptionId,
    saleId,
    type,
    affectsService: Boolean(affectsService),
    lines: normalizadas,
    subtotal,
    discountType: tipo,
    discount: tipo === 'none' ? 0 : redondear(valorDescuento),
    discountAmount: calculado.discountAmount,
    taxBase: calculado.taxBase,
    taxRate: redondear(tasa) / 100,
    tax: calculado.tax,
    total: calculado.total,
    currency: 'USD',
    dueDate: vencimiento,
    issueDate: emision,
    notes: String(notes || '').trim().slice(0, 500),
    status: 'open',
  });

  await registrar({
    module: 'financial',
    entity: 'Invoice',
    entityId: factura._id,
    action: 'billing_issue',
    description: `Factura ${invoiceNumber} (${ETIQUETAS_ESTADO[type] || type}) creada por USD ${factura.total.toFixed(2)}.`,
    changes: { after: { invoiceNumber, type, total: factura.total, affectsService: factura.affectsService } },
    actor,
  });

  return factura;
}

/**
 * Al reactivar el servicio, el período vuelve a contar desde hoy para no
 * cobrar los meses en que el cliente estuvo cortado.
 */
function reanudarPeriodo(subscription) {
  const ahora = new Date();
  const fin = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  if (fin && fin >= ahora) return false;
  const intervalo = subscription.planSnapshot?.billingInterval || 'monthly';
  subscription.currentPeriodStart = ahora;
  subscription.currentPeriodEnd = sumarIntervalo(ahora, intervalo);
  return true;
}

/**
 * Calcula las facturas que se emitirían sin escribir en la base de datos.
 * Solo factura a clientes activos: los suspendidos y retirados no se cobran.
 */
async function previsualizar(settingsOverride = null) {
  const settings = settingsOverride || (await Settings.getSingleton());
  const limite = sumarDias(new Date(), settings.billing.previewDays);

  const suscripciones = await Subscription.find({
    status: 'active',
    currentPeriodEnd: { $lte: limite },
  })
    .populate('clientId')
    .populate('planId')
    .sort({ currentPeriodEnd: 1 });

  const elegibles = suscripciones.filter(
    (s) => s.clientId && s.clientId.status === 'active' && s.planSnapshot
  );

  if (!elegibles.length) return { items: [], settings, omitidas: [] };

  const ids = elegibles.map((s) => s._id);
  const fechas = elegibles.map((s) => s.currentPeriodStart);
  const minimo = new Date(Math.min(...fechas.map((f) => new Date(f).getTime())));
  const maximo = new Date(Math.max(...fechas.map((f) => new Date(f).getTime())));

  const existentes = await Invoice.find({
    subscriptionId: { $in: ids },
    periodStart: { $gte: minimo, $lte: maximo },
  })
    .select('subscriptionId periodStart')
    .lean();

  const yaFacturadas = new Set(
    existentes.map((factura) => clavePeriodo(factura.subscriptionId, factura.periodStart))
  );

  const items = [];
  const omitidas = [];

  for (const subscription of elegibles) {
    const clave = clavePeriodo(subscription._id, subscription.currentPeriodStart);
    if (yaFacturadas.has(clave)) {
      omitidas.push(subscription);
      continue;
    }

    const taxRate =
      settings.billing.taxEnabled === false
        ? 0
        : subscription.planSnapshot.taxRate === null || subscription.planSnapshot.taxRate === undefined
          ? settings.billing.taxRate
          : Number(subscription.planSnapshot.taxRate);
    const { subtotal, discountAmount, taxBase, tax, total } = importes(subscription.planSnapshot.price, taxRate);
    items.push({
      subscription,
      client: subscription.clientId,
      plan: subscription.planSnapshot,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      subtotal,
      discountType: 'none',
      discount: 0,
      discountAmount,
      taxBase,
      taxRate,
      tax,
      total,
      currency: 'USD',
      dueDate: sumarDias(new Date(), settings.billing.dueDays),
    });
  }

  return { items, settings, omitidas };
}

/**
 * Emite las facturas elegibles de forma idempotente.
 */
async function emitir({ actor = 'admin' } = {}) {
  const settings = await Settings.getSingleton();
  const { items, omitidas } = await previsualizar(settings);

  const resumen = {
    procesadas: items.length + omitidas.length,
    creadas: 0,
    omitidas: omitidas.length,
    fallidas: 0,
    detalle: [],
    errores: [],
  };

  for (const item of items) {
    try {
      const invoiceNumber = await siguienteNumeroFactura(settings);
      const issueDate = new Date();
      const dueDate = sumarDias(issueDate, settings.billing.dueDays);

      const snapshotBase = item.plan.toObject ? item.plan.toObject() : { ...item.plan };
      delete snapshotBase._id;
      delete snapshotBase.__v;
      delete snapshotBase.createdAt;
      delete snapshotBase.updatedAt;

      const factura = await Invoice.create({
        invoiceNumber,
        clientId: item.client._id,
        subscriptionId: item.subscription._id,
        type: 'service',
        affectsService: true,
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
        issueDate,
        dueDate,
        planSnapshot: { ...snapshotBase, capturedAt: new Date() },
        lines: [
          {
            description: `Servicio ${item.plan.name} · ${formatearFecha(item.periodStart)} al ${formatearFecha(item.periodEnd)}`,
            quantity: 1,
            unitPrice: item.subtotal,
            amount: item.subtotal,
          },
        ],
        subtotal: item.subtotal,
        discountType: item.discountType,
        discount: item.discount,
        discountAmount: item.discountAmount,
        taxBase: item.taxBase,
        taxRate: item.taxRate,
        tax: item.tax,
        total: item.total,
        currency: 'USD',
        status: 'open',
      });

      await Subscription.updateOne(
        { _id: item.subscription._id },
        {
          $set: {
            currentPeriodStart: item.periodEnd,
            currentPeriodEnd: sumarIntervalo(item.periodEnd, item.plan.billingInterval),
          },
        }
      );

      resumen.creadas += 1;
      resumen.detalle.push(factura);

      await registrar({
        module: 'financial',
        entity: 'Invoice',
        entityId: factura._id,
        action: 'billing_issue',
        description: `Factura ${invoiceNumber} emitida para ${item.client.clientCode} por USD ${item.total.toFixed(2)}.`,
        changes: { after: { invoiceNumber, total: item.total, currency: 'USD' } },
        actor,
      });
    } catch (error) {
      if (error.code === 11000) {
        resumen.omitidas += 1;
      } else {
        resumen.fallidas += 1;
        resumen.errores.push(`${item.client.clientCode}: ${error.message}`);
        await registrar({
          module: 'financial',
          entity: 'Invoice',
          entityId: item.subscription._id,
          action: 'billing_issue',
          description: `Falló la emisión para ${item.client.clientCode}.`,
          commandResult: error.message,
          status: 'failed',
          actor,
        });
      }
    }
  }

  /* Si la factura ya existía pero el periodo no avanzó (fallo entre ambas
     escrituras), se avanza aquí para que el servicio no quede bloqueado. */
  for (const subscription of omitidas) {
    const fin = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
    if (!fin) continue;
    await Subscription.updateOne(
      { _id: subscription._id, currentPeriodStart: subscription.currentPeriodStart },
      {
        $set: {
          currentPeriodStart: fin,
          currentPeriodEnd: sumarIntervalo(fin, subscription.planSnapshot?.billingInterval),
        },
      }
    ).catch(() => null);
  }

  await registrar({
    module: 'financial',
    entity: 'Invoice',
    action: 'billing_issue',
    description: `Corrida de facturación: ${resumen.creadas} creadas, ${resumen.omitidas} omitidas, ${resumen.fallidas} fallidas.`,
    changes: { after: resumen },
    status: resumen.fallidas ? 'failed' : 'success',
    actor,
  });

  return resumen;
}

/** Marca como vencidas las facturas abiertas cuya fecha de pago ya pasó. */
async function marcarVencidas() {
  const hoy = inicioDelDia();
  const resultado = await Invoice.updateMany(
    { status: 'open', dueDate: { $lt: hoy } },
    { $set: { status: 'overdue' } }
  );
  return resultado.modifiedCount || 0;
}

/**
 * Ejecuta la mora: marca vencidas, detecta las que superaron la gracia
 * y corta el servicio de cada cliente.
 */
async function ejecutarMora({ actor = 'system' } = {}) {
  const settings = await Settings.getSingleton();
  const vencidas = await marcarVencidas();
  const corteDesde = inicioDelDia(sumarDias(new Date(), -settings.billing.graceDays));

  const facturas = await Invoice.find({
    status: 'overdue',
    type: 'service',
    affectsService: true,
    dueDate: { $lt: corteDesde },
  })
    .populate('clientId')
    .sort({ dueDate: 1 });

  const porCliente = new Map();
  for (const factura of facturas) {
    if (!factura.clientId) continue;
    const id = String(factura.clientId._id);
    if (!porCliente.has(id)) porCliente.set(id, []);
    porCliente.get(id).push(factura);
  }

  const resumen = {
    vencidas,
    clientes: porCliente.size,
    cortadas: 0,
    omitidas: 0,
    fallidas: 0,
    detalle: [],
  };

  for (const [clientId, pendientes] of porCliente) {
    const servicios = await Subscription.find({ clientId }).populate('clientId').populate('planId');
    const activos = servicios.filter(
      (servicio) => servicio.status === 'active' && servicio.firewallState !== 'blocked' && servicio.serviceConfig?.routerId
    );
    resumen.omitidas += servicios.filter((servicio) => servicio.status === 'active' && !servicio.serviceConfig?.routerId).length;
    if (!servicios.length || !activos.length) {
      resumen.omitidas += 1;
      continue;
    }

    const deuda = redondear(pendientes.reduce((suma, f) => suma + f.total, 0));
    for (const subscription of activos) {
      let resultado;
      try {
        resultado = await firewallService.bloquear(subscription, {
          reason: `Mora de USD ${deuda.toFixed(2)} (${pendientes.length} factura(s)).`,
          actor,
          motivo: 'billing',
          estadoAnterior: { status: subscription.status, firewallState: subscription.firewallState },
        });
      } catch (error) {
        resumen.fallidas += 1;
        resumen.detalle.push({
          cliente: subscription.clientId?.clientCode,
          nombre: subscription.clientId?.fullName,
          deuda,
          error: error.message,
        });
        continue;
      }

      if (resultado.omitted) {
        resumen.omitidas += 1;
      } else if (resultado.ok) {
        resumen.cortadas += 1;
        resumen.detalle.push({
          cliente: subscription.clientId?.clientCode,
          nombre: subscription.clientId?.fullName,
          deuda,
          comando: resultado.command,
        });
      } else {
        resumen.fallidas += 1;
      }
    }
  }

  await registrar({
    module: 'financial',
    entity: 'Invoice',
    action: 'billing_overdue',
    description: `Corrida de mora: ${vencidas} vencidas, ${resumen.cortadas} cortadas, ${resumen.omitidas} omitidas, ${resumen.fallidas} fallidas.`,
    changes: { after: resumen },
    status: resumen.fallidas ? 'failed' : 'success',
    actor,
  });

  return resumen;
}

async function deudaCliente(clientId, { soloServicio = false } = {}) {
  const filtro = { clientId: new mongoose.Types.ObjectId(String(clientId)), status: { $in: ESTADOS_PENDIENTES } };
  if (soloServicio) {
    filtro.type = 'service';
    filtro.affectsService = true;
  }
  const resultado = await Invoice.aggregate([
    { $match: filtro },
    { $group: { _id: null, total: { $sum: '$total' }, cantidad: { $sum: 1 } } },
  ]);
  return resultado[0] || { total: 0, cantidad: 0 };
}

/** Deuda que sí puede provocar corte: solo facturas de servicio. */
async function deudaServicioCliente(clientId) {
  return deudaCliente(clientId, { soloServicio: true });
}

async function deudasPorCliente() {
  const filas = await Invoice.aggregate([
    { $match: { status: { $in: ESTADOS_PENDIENTES } } },
    { $group: { _id: '$clientId', total: { $sum: '$total' }, cantidad: { $sum: 1 } } },
  ]);
  return new Map(filas.map((fila) => [String(fila._id), { total: fila.total, cantidad: fila.cantidad }]));
}

async function pagar(
  invoiceId,
  {
    paymentMethod = 'cash',
    paymentReference = '',
    paymentCurrency = 'USD',
    exchangeRate = 0,
    rateSource = 'manual',
    actor = 'admin',
  } = {}
) {
  const factura = await Invoice.findById(invoiceId).populate('clientId');
  if (!factura) throw crearError(404, 'La factura no existe.');
  if (!ESTADOS_PENDIENTES.includes(factura.status)) {
    throw crearError(409, `La factura ${factura.invoiceNumber} no se puede pagar en estado ${ETIQUETAS_ESTADO[factura.status] || factura.status}.`);
  }
  if (factura.currency !== 'USD') {
    throw crearError(422, 'Los pagos se registran sobre facturas en USD. Convierte la factura antes de cobrar.');
  }

  const moneda = MONEDAS_PAGO.includes(paymentCurrency) ? paymentCurrency : 'USD';
  const metodos = moneda === 'VES' ? METODOS_PAGO_BS : METODOS_PAGO_USD;
  if (!metodos.includes(paymentMethod)) {
    throw crearError(422, `El método de pago no es válido para ${moneda === 'VES' ? 'bolívares' : 'dólares'}.`);
  }

  const tasa = Number(exchangeRate);
  if (moneda === 'VES' && (!Number.isFinite(tasa) || tasa <= 0)) {
    throw crearError(422, 'Indica una tasa válida (Bs por USD) para cobrar en bolívares.');
  }
  const tasaAplicada = Number.isFinite(tasa) && tasa > 0 ? tasa : 0;

  const ahora = new Date();
  const montoPago = moneda === 'VES' ? redondear(factura.total * tasaAplicada) : redondear(factura.total);
  const antes = {
    status: factura.status,
    paidAt: factura.paidAt,
    paymentMethod: factura.paymentMethod,
    paymentCurrency: factura.paymentCurrency,
    paymentAmount: factura.paymentAmount,
    exchangeRate: factura.exchangeRate,
  };

  // Transición atómica: dos cobros simultáneos no pueden pagar la misma factura.
  const actualizada = await Invoice.findOneAndUpdate(
    { _id: factura._id, status: { $in: ESTADOS_PENDIENTES } },
    {
      $set: {
        status: 'paid',
        paidAt: ahora,
        paymentMethod,
        paymentCurrency: moneda,
        paymentAmount: montoPago,
        exchangeRate: tasaAplicada,
        paymentRateSource: String(rateSource || 'manual').slice(0, 40),
        paymentRateDate: ahora,
        paymentReference,
      },
    },
    { new: true }
  ).populate('clientId');

  if (!actualizada) {
    throw crearError(409, 'La factura ya fue pagada o anulada por otro usuario.');
  }

  const pendientes = actualizada.clientId
    ? await Invoice.countDocuments({
        clientId: actualizada.clientId._id,
        status: { $in: ESTADOS_PENDIENTES },
        type: 'service',
        affectsService: true,
      })
    : 0;

  let firewall = null;
  /* El cobro ya está hecho y es atómico: un fallo al desbloquear o reanudar
     no debe perder el pago ni su auditoría; se informa como restaur. fallida. */
  try {
    const suscripciones = actualizada.clientId
      ? await Subscription.find({ clientId: actualizada.clientId._id })
      : [];
    const estadoCliente = actualizada.clientId
      ? await Client.findById(actualizada.clientId._id).select('status statusReason').lean()
      : null;
    /* Un corte manual por abuso no se levanta solo porque pagó una factura. */
    const cortePorMora = !estadoCliente || estadoCliente.statusReason !== 'manual';
    if (actualizada.affectsService && actualizada.clientId && pendientes === 0 && cortePorMora) {
      for (const subscription of suscripciones) {
        if (subscription.status !== 'suspended' && subscription.firewallState !== 'error') continue;
        const resultado = await firewallService.desbloquear(subscription, {
          reason: `Pago total de la factura ${actualizada.invoiceNumber}.`,
          actor,
          estadoAnterior: { status: subscription.status, firewallState: subscription.firewallState },
        });
        if (!firewall) firewall = resultado;
      }
    }

    /* Pagó todo: el cliente vuelve a estar activo solo si el router confirmó. */
    if (firewall && firewall.ok && !firewall.omitted && actualizada.clientId) {
      await Client.updateOne(
        { _id: actualizada.clientId._id, status: { $ne: 'retired' } },
        { $set: { status: 'active', statusReason: '' } }
      );
    }

    /* El servicio vuelve a contar desde hoy: no se cobran los meses cortados. */
    if (actualizada.affectsService && actualizada.clientId && pendientes === 0) {
      for (const subscription of suscripciones) {
        const actual = await Subscription.findById(subscription._id);
        if (actual && reanudarPeriodo(actual)) await actual.save();
      }
    }
  } catch (error) {
    firewall = { ok: false, omitted: false, result: error.message };
  }

  await registrar({
    module: 'financial',
    entity: 'Invoice',
    entityId: actualizada._id,
    action: 'payment',
    description: `Pago total de ${actualizada.invoiceNumber} (${actualizada.currency} ${actualizada.total.toFixed(2)}) en ${moneda === 'VES' ? 'Bs' : 'USD'} con ${ETIQUETAS_ESTADO[paymentMethod] || paymentMethod} · tasa ${tasa}.`,
    changes: {
      before: antes,
      after: {
        status: actualizada.status,
        paidAt: actualizada.paidAt,
        paymentMethod: actualizada.paymentMethod,
        paymentCurrency: actualizada.paymentCurrency,
        paymentAmount: actualizada.paymentAmount,
        exchangeRate: actualizada.exchangeRate,
        paymentRateSource: actualizada.paymentRateSource,
      },
    },
    status: 'success',
    actor,
  });

  return { factura: actualizada, pendientes, firewall };
}

async function anular(invoiceId, { reason, actor = 'admin' } = {}) {
  if (!reason || !String(reason).trim()) throw crearError(422, 'El motivo de anulación es obligatorio.');
  const motivo = String(reason).trim();
  const previa = await Invoice.findById(invoiceId);
  if (!previa) throw crearError(404, 'La factura no existe.');
  if (!ESTADOS_PENDIENTES.includes(previa.status)) {
    throw crearError(409, 'Solo se pueden anular facturas pendientes o vencidas.');
  }

  if (['sale', 'installation'].includes(previa.type)) {
    const venta = previa.saleId ? await Sale.findById(previa.saleId).select('status code').lean() : null;
    if (venta && venta.status === 'installed') {
      throw crearError(409, `No se puede anular ${previa.invoiceNumber}: la venta ${venta.code} ya está instalada. Cancela la venta o retira el equipo primero.`);
    }
    if (previa.subscriptionId) {
      const servicio = await Subscription.findById(previa.subscriptionId).select('status').lean();
      if (servicio && ['active', 'suspended'].includes(servicio.status)) {
        throw crearError(409, `No se puede anular ${previa.invoiceNumber}: el servicio sigue activo. Cancela el servicio antes de anular la factura.`);
      }
    }
    const conInventario = (previa.lines || []).filter((linea) => linea.inventoryItemId);
    const existentes = await InventoryItem.find({ _id: { $in: conInventario.map((linea) => linea.inventoryItemId) } }).select('_id').lean();
    const ids = new Set(existentes.map((item) => String(item._id)));
    const faltante = conInventario.find((linea) => !ids.has(String(linea.inventoryItemId)));
    if (faltante) {
      throw crearError(409, `No se puede anular: falta en el inventario el artículo "${faltante.description}".`);
    }
  }

  const factura = await Invoice.findOneAndUpdate(
    { _id: invoiceId, status: { $in: ESTADOS_PENDIENTES } },
    { $set: { status: 'void', voidedAt: new Date(), voidReason: motivo } },
    { new: true }
  );
  if (!factura) {
    throw crearError(409, 'La factura ya fue pagada o anulada por otro usuario.');
  }

  let inventario = [];
  if (['sale', 'installation'].includes(factura.type)) {
    try {
      inventario = await inventoryService.restaurarFactura(factura, { actor });
    } catch (error) {
      /* Si no se pudo devolver el stock, la factura vuelve a su estado anterior. */
      await Invoice.updateOne(
        { _id: factura._id, status: 'void' },
        { $set: { status: previa.status, voidedAt: null, voidReason: '' } }
      ).catch(() => null);
      throw error.status ? error : crearError(409, `No se anuló la factura: ${error.message}`);
    }
  }

  await registrar({
    module: 'financial',
    entity: 'Invoice',
    entityId: factura._id,
    action: 'void',
    description: `Factura ${factura.invoiceNumber} anulada: ${factura.voidReason}`,
    changes: {
      before: { status: previa.status },
      after: { status: factura.status, voidedAt: factura.voidedAt, inventarioRestaurado: inventario.length },
    },
    status: 'success',
    actor,
  });

  return factura;
}

async function actualizarFactura(
  invoiceId,
  { taxRatePercent, discountType = 'none', discount = 0, dueDate, notes = '', actor = 'admin' } = {}
) {
  const factura = await Invoice.findById(invoiceId);
  if (!factura) throw crearError(404, 'La factura no existe.');
  if (!ESTADOS_PENDIENTES.includes(factura.status)) {
    throw crearError(409, 'Solo se pueden editar facturas pendientes o vencidas. Las pagadas y anuladas son inmutables.');
  }

  const antes = {
    taxRate: factura.taxRate,
    discountType: factura.discountType,
    discount: factura.discount,
    dueDate: factura.dueDate,
    total: factura.total,
    notes: factura.notes,
  };

  const settings = await Settings.getSingleton();
  const tasa =
    settings.billing.taxEnabled === false
      ? 0
      : taxRatePercent === undefined || taxRatePercent === ''
        ? factura.taxRate * 100
        : Number(taxRatePercent);
  if (!Number.isFinite(tasa) || tasa < 0 || tasa > 100) {
    throw crearError(422, 'El IVA debe estar entre 0 y 100 %.');
  }

  const tipo = ['none', 'percent', 'amount'].includes(discountType) ? discountType : 'none';
  const valorDescuento = tipo === 'none' ? 0 : Number(discount);
  if (!Number.isFinite(valorDescuento) || valorDescuento < 0) {
    throw crearError(422, 'El descuento debe ser un número mayor o igual a 0.');
  }
  if (tipo === 'percent' && valorDescuento > 100) {
    throw crearError(422, 'El descuento porcentual no puede superar 100 %.');
  }
  if (tipo === 'amount' && valorDescuento > factura.subtotal) {
    throw crearError(422, 'El descuento no puede superar el subtotal de la factura.');
  }

  let nuevaFecha = factura.dueDate;
  if (dueDate) {
    nuevaFecha = new Date(`${String(dueDate).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(nuevaFecha.getTime())) throw crearError(422, 'La fecha de vencimiento no es válida.');
  }

  const calculado = importes(factura.subtotal, redondear(tasa) / 100, { discountType: tipo, discount: valorDescuento });

  factura.taxRate = redondear(tasa) / 100;
  factura.discountType = tipo;
  factura.discount = tipo === 'none' ? 0 : redondear(valorDescuento);
  factura.discountAmount = calculado.discountAmount;
  factura.taxBase = calculado.taxBase;
  factura.tax = calculado.tax;
  factura.total = calculado.total;
  factura.dueDate = nuevaFecha;
  if (['open', 'overdue'].includes(factura.status)) {
    factura.status = nuevaFecha.getTime() < inicioDelDia().getTime() ? 'overdue' : 'open';
  }
  factura.notes = String(notes || '').trim().slice(0, 500);
  await factura.save();

  await registrar({
    module: 'financial',
    entity: 'Invoice',
    entityId: factura._id,
    action: 'update',
    description: `Factura ${factura.invoiceNumber} actualizada: IVA ${Math.round(factura.taxRate * 100)} %, total ${factura.currency} ${factura.total.toFixed(2)}.`,
    changes: {
      before: antes,
      after: {
        taxRate: factura.taxRate,
        discountType: factura.discountType,
        discount: factura.discount,
        dueDate: factura.dueDate,
        total: factura.total,
        notes: factura.notes,
      },
    },
    status: 'success',
    actor,
  });

  return factura;
}

async function topDeudores(limite = 5) {
  const filas = await Invoice.aggregate([
    { $match: { status: { $in: ESTADOS_PENDIENTES } } },
    { $group: { _id: '$clientId', total: { $sum: '$total' }, cantidad: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: limite },
    {
      $lookup: {
        from: 'clients',
        localField: '_id',
        foreignField: '_id',
        as: 'cliente',
      },
    },
    { $unwind: { path: '$cliente', preserveNullAndEmptyArrays: true } },
  ]);
  return filas.map((fila) => ({
    clientId: fila._id,
    total: fila.total,
    cantidad: fila.cantidad,
    clientCode: fila.cliente?.clientCode || '—',
    nombre: fila.cliente ? `${fila.cliente.firstName} ${fila.cliente.lastName}` : 'Cliente eliminado',
  }));
}

module.exports = {
  ESTADOS_PENDIENTES,
  previsualizar,
  emitir,
  marcarVencidas,
  ejecutarMora,
  deudaCliente,
  deudaServicioCliente,
  deudasPorCliente,
  crearFactura,
  siguienteNumeroFactura,
  pagar,
  anular,
  actualizarFactura,
  topDeudores,
  importes,
  reanudarPeriodo,
};
