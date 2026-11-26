const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Subscription = require('../models/Subscription');
const InventoryItem = require('../models/InventoryItem');
const AuditLog = require('../models/AuditLog');
const billingService = require('../services/billingService');
const inventoryService = require('../services/inventoryService');
const { crearError, mensajeDeError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const { FACTURAS_POR_PAGINA, METODOS_PAGO, TIPOS_FACTURA, MONEDAS_PAGO, METODOS_PAGO_USD, METODOS_PAGO_BS, ETIQUETAS_MONEDA_PAGO } = require('../config/constants');
const exchangeRateService = require('../services/exchangeRateService');
const { escaparRegex } = require('../utils/strings');
const { inicioDelDia, finDelDia } = require('../utils/dates');

function leerLineas(body = {}) {
  const descripciones = [].concat(body.description || []);
  const cantidades = [].concat(body.quantity || []);
  const precios = [].concat(body.unitPrice || []);
  const itemIds = [].concat(body.inventoryItemId || []);
  const seriales = [].concat(body.serials || []);
  return descripciones
    .map((descripcion, indice) => ({
      description: String(descripcion || '').trim(),
      quantity: Number(cantidades[indice]) || 0,
      unitPrice: Number(precios[indice]) || 0,
      inventoryItemId: itemIds[indice] || null,
      serials: String(seriales[indice] || '').split(/[,;\s]+/).filter(Boolean).map((s) => s.toUpperCase()),
    }))
    .filter((linea) => linea.description && linea.quantity > 0);
}

/** GET /facturas */
async function index(req, res, next) {
  try {
    const { q = '', estado = '', cliente = '', tipo = '', desde = '', hasta = '', page = 1 } = req.query;
    const consulta = {};
    if (estado === 'pendientes') consulta.status = { $in: billingService.ESTADOS_PENDIENTES };
    else if (estado) consulta.status = estado;
    if (cliente) {
      if (!mongoose.isValidObjectId(cliente)) throw crearError(404, 'El cliente indicado no existe.');
      consulta.clientId = new mongoose.Types.ObjectId(cliente);
    }
    if (TIPOS_FACTURA.includes(tipo)) consulta.type = tipo;
    if (desde || hasta) {
      consulta.issueDate = {};
      if (desde) consulta.issueDate.$gte = inicioDelDia(desde);
      if (hasta) consulta.issueDate.$lte = finDelDia(hasta);
    }
    if (q.trim()) {
      const regex = new RegExp(escaparRegex(q.trim()), 'i');
      const clientes = await Client.find({
        $or: [{ firstName: regex }, { lastName: regex }, { clientCode: regex }],
      }).select('_id').lean();
      consulta.$or = [
        { invoiceNumber: regex },
        { clientId: { $in: clientes.map((c) => c._id) } },
      ];
    }

    const total = await Invoice.countDocuments(consulta);
    const paginas = Math.max(1, Math.ceil(total / FACTURAS_POR_PAGINA));
    const actual = Math.min(Math.max(1, Number(page) || 1), paginas);

    const [facturas, resumenFilas, clientes, tipos] = await Promise.all([
      Invoice.find(consulta)
        .populate('clientId')
        .sort({ issueDate: -1, invoiceNumber: -1 })
        .skip((actual - 1) * FACTURAS_POR_PAGINA)
        .limit(FACTURAS_POR_PAGINA)
        .lean(),
      Invoice.aggregate([
        { $match: consulta },
        { $group: { _id: '$status', cantidad: { $sum: 1 }, total: { $sum: '$total' } } },
      ]),
      Client.find().sort({ firstName: 1, lastName: 1 }).select('firstName lastName clientCode').lean(),
      Invoice.aggregate([
        { $match: consulta },
        { $group: { _id: '$type', cantidad: { $sum: 1 }, total: { $sum: '$total' } } },
      ]),
    ]);

    const resumen = { open: 0, overdue: 0, paid: 0, void: 0, draft: 0 };
    for (const fila of resumenFilas) {
      if (fila._id in resumen) resumen[fila._id] = { cantidad: fila.cantidad, total: fila.total };
    }

    res.render('invoices/index', {
      titulo: 'Facturas',
      facturas,
      filtros: { q, estado, cliente, tipo, desde, hasta },
      paginacion: { actual, paginas, total },
      resumen,
      clientes,
      tipos,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /facturas/nueva */
async function formNuevo(req, res, next) {
  try {
    const [clientes, subscriptions, items] = await Promise.all([
      Client.find().sort({ firstName: 1, lastName: 1 }).lean(),
      Subscription.find().populate('clientId').populate('planId').lean(),
      InventoryItem.find({ active: true }).sort({ category: 1, name: 1 }),
    ]);
    res.render('invoices/form', {
      titulo: 'Nueva factura de venta',
      clientes,
      subscriptions,
      items,
      clienteSeleccionado: req.query.cliente || '',
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** POST /facturas — facturas manuales de venta, nunca cortan el servicio. */
async function crear(req, res, next) {
  try {
    const lineas = leerLineas(req.body);
    if (!lineas.length) throw crearError(422, 'Agrega al menos una línea a la factura.');
    const cliente = await Client.findById(req.body.clientId);
    if (!cliente) throw crearError(422, 'Selecciona un cliente válido.');

    const conInventario = lineas.some((linea) => linea.inventoryItemId);
    const tipo = conInventario ? 'sale' : (req.body.type === 'other' ? 'other' : 'sale');
    const facturaId = new mongoose.Types.ObjectId();
    let consumidos = [];

    if (conInventario) {
      consumidos = await inventoryService.consumirLineas(
        lineas.filter((l) => l.inventoryItemId).map((l) => ({
          itemId: l.inventoryItemId,
          quantity: l.quantity,
          serials: l.serials,
        })),
        {
          clientId: cliente._id,
          invoiceId: facturaId,
          tipo: 'venta',
          reason: 'Factura de venta en preparación',
        }
      );
    }

    let factura;
    try {
      factura = await billingService.crearFactura({
        _id: facturaId,
        clientId: cliente._id,
        subscriptionId: req.body.subscriptionId || null,
        lines: lineas,
        taxRatePercent: req.body.taxRatePercent,
        discountType: req.body.discountType,
        discount: req.body.discount,
        dueDate: req.body.dueDate,
        notes: req.body.notes,
        type: tipo,
        affectsService: false,
      });
    } catch (error) {
      if (consumidos.length) {
        await inventoryService.devolverLineas(consumidos, {
          reason: `Reversión por error al crear la factura: ${error.message}`,
          actor: req.usuario ? req.usuario.username : 'admin',
        }).catch(() => null);
      }
      throw error;
    }

    req.flash('exito', `Factura ${factura.invoiceNumber} creada. No participa en el corte automático del servicio.`);
    res.redirect(`/facturas/${factura._id}`);
  } catch (error) {
    if (error.status || error.name === 'ValidationError') {
      const [clientes, subscriptions, items] = await Promise.all([
        Client.find().sort({ firstName: 1, lastName: 1 }).lean(),
        Subscription.find().populate('clientId').populate('planId').lean(),
        InventoryItem.find({ active: true }).sort({ category: 1, name: 1 }),
      ]);
      return res.status(422).render('invoices/form', {
        titulo: 'Nueva factura de venta',
        clientes,
        subscriptions,
        items,
        clienteSeleccionado: req.body.clientId || '',
        errores: [mensajeDeError(error)],
      });
    }
    next(error);
  }
}

/** GET /facturas/:id */
async function show(req, res, next) {
  try {
    const factura = await Invoice.findById(req.params.id)
      .populate('clientId')
      .populate({ path: 'subscriptionId', populate: { path: 'planId' } });
    if (!factura) throw crearError(404, 'La factura no existe.');

    const logs = await AuditLog.find({ entityId: String(factura._id) })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();

    const tasa = await exchangeRateService.tasaActual();

    res.render('invoices/show', {
      titulo: `Factura ${factura.invoiceNumber}`,
      factura,
      logs,
      metodosPago: METODOS_PAGO,
      monedasPago: MONEDAS_PAGO,
      metodosPagoUsd: METODOS_PAGO_USD,
      metodosPagoBs: METODOS_PAGO_BS,
      etiquetasMoneda: ETIQUETAS_MONEDA_PAGO,
      tasa,
      totalBs: exchangeRateService.convertirUsdABs(factura.total, tasa.rate),
    });
  } catch (error) {
    next(error);
  }
}

/** GET /facturas/:id/editar */
async function formEditar(req, res, next) {
  try {
    const factura = await Invoice.findById(req.params.id).populate('clientId');
    if (!factura) throw crearError(404, 'La factura no existe.');
    if (!['open', 'overdue'].includes(factura.status)) {
      req.flash('error', 'Solo se pueden editar facturas pendientes o vencidas.');
      return res.redirect(`/facturas/${factura._id}`);
    }

    res.render('invoices/edit', {
      titulo: `Editar ${factura.invoiceNumber}`,
      factura,
      errores: [],
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /facturas/:id */
async function actualizar(req, res, next) {
  try {
    const factura = await billingService.actualizarFactura(req.params.id, {
      taxRatePercent: req.body.taxRatePercent,
      discountType: req.body.discountType,
      discount: req.body.discount,
      dueDate: req.body.dueDate,
      notes: req.body.notes,
      actor: 'admin',
    });
    req.flash('exito', `Factura ${factura.invoiceNumber} actualizada. Total: ${factura.currency} ${factura.total.toFixed(2)}.`);
    res.redirect(`/facturas/${factura._id}`);
  } catch (error) {
    if (error.status || error.name === 'ValidationError') {
      const factura = await Invoice.findById(req.params.id).populate('clientId');
      if (!factura) return next(error);
      const { lista, campos } = normalizarErrores(error);
      return res.status(422).render('invoices/edit', {
        titulo: `Editar ${factura.invoiceNumber}`,
        factura,
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

/** POST /facturas/:id/pagar */
async function pagar(req, res, next) {
  try {
    const moneda = MONEDAS_PAGO.includes(req.body.paymentCurrency) ? req.body.paymentCurrency : 'USD';
    const guardada = await exchangeRateService.tasaActual();
    const manual = Number(req.body.exchangeRate);
    const tasaManual = Number.isFinite(manual) && manual > 0 ? manual : 0;
    const tasa = tasaManual || (guardada.ok && guardada.rate > 0 ? guardada.rate : 0);
    if (moneda === 'VES' && !tasa) {
      throw crearError(422, 'Indica la tasa en bolívares por dólar para este cobro.');
    }

    const resultado = await billingService.pagar(req.params.id, {
      paymentMethod: req.body.paymentMethod,
      paymentReference: String(req.body.paymentReference || '').trim(),
      paymentCurrency: moneda,
      exchangeRate: tasa,
      rateSource: tasaManual ? 'manual' : guardada.source || 'guardada',
    });

    if (resultado.firewall) {
      if (resultado.firewall.ok) {
        req.flash('exito', `Factura ${resultado.factura.invoiceNumber} pagada. Servicio restaurado y comando registrado.`);
      } else {
        req.flash('error', `Factura pagada, pero la restauración del servicio falló: ${resultado.firewall.result}. Puedes reintentar desde la ficha del cliente.`);
      }
    } else {
      req.flash('exito', `Factura ${resultado.factura.invoiceNumber} pagada correctamente.`);
    }

    res.redirect(`/facturas/${resultado.factura._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect(`/facturas/${req.params.id}`);
    }
    next(error);
  }
}

/** POST /facturas/:id/anular */
async function anular(req, res, next) {
  try {
    const factura = await billingService.anular(req.params.id, { reason: req.body.voidReason });
    req.flash('exito', `Factura ${factura.invoiceNumber} anulada. No se borró y conserva su número.`);
    res.redirect(`/facturas/${factura._id}`);
  } catch (error) {
    if (error.status) {
      req.flash('error', error.message);
      return res.redirect(`/facturas/${req.params.id}`);
    }
    if (error.name === 'ValidationError') {
      req.flash('error', mensajeDeError(error));
      return res.redirect(`/facturas/${req.params.id}`);
    }
    next(error);
  }
}

module.exports = { index, formNuevo, crear, show, formEditar, actualizar, pagar, anular };
