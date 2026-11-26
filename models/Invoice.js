const mongoose = require('mongoose');
const { ESTADOS_FACTURA, METODOS_PAGO, MONEDAS_PAGO, MONEDAS, TIPOS_FACTURA } = require('../config/constants');

const codigosMoneda = MONEDAS.map((moneda) => moneda.code);

const lineaSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 200 },
    quantity: { type: Number, required: true, default: 1, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    cost: { type: Number, min: 0, default: 0 },
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
    serials: { type: [String], default: [] },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null, index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    type: { type: String, enum: TIPOS_FACTURA, default: 'service', index: true },
    /**
     * Solo las facturas con `affectsService: true` participan en la mora y
     * en el corte automático del servicio. Las ventas e instalaciones no cortan.
     */
    affectsService: { type: Boolean, default: true, index: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    issueDate: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date, required: true, index: true },
    planSnapshot: {
      name: String,
      downloadSpeed: Number,
      uploadSpeed: Number,
      price: Number,
      taxRate: { type: Number, min: 0, max: 1, default: null },
      billingInterval: String,
      capturedAt: Date,
    },
    lines: { type: [lineaSchema], validate: [(lineas) => lineas.length > 0, 'La factura debe tener al menos una línea.'] },
    subtotal: { type: Number, required: true, min: 0 },
    discountType: { type: String, enum: ['none', 'percent', 'amount'], default: 'none' },
    discount: { type: Number, min: 0, default: 0 },
    discountAmount: { type: Number, min: 0, default: 0 },
    taxBase: { type: Number, min: 0 },
    taxRate: { type: Number, required: true, min: 0, max: 1 },
    tax: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
    currency: { type: String, uppercase: true, enum: codigosMoneda, default: 'USD' },
    status: { type: String, enum: ESTADOS_FACTURA, default: 'open', index: true },
    paidAt: { type: Date },
    paymentMethod: { type: String, enum: [...METODOS_PAGO, null], default: null },
    paymentCurrency: { type: String, enum: [...MONEDAS_PAGO, null], default: null },
    paymentAmount: { type: Number, min: 0, default: null },
    exchangeRate: { type: Number, min: 0, default: null },
    paymentRateSource: { type: String, trim: true, default: '', maxlength: 40 },
    paymentRateDate: { type: Date, default: null },
    paymentReference: { type: String, trim: true, default: '', maxlength: 120 },
    voidedAt: { type: Date },
    voidReason: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/**
 * La idempotencia por periodo solo aplica a facturas de servicio.
 * Las facturas manuales o de instalación no tienen periodo y pueden repetirse.
 */
invoiceSchema.index(
  { subscriptionId: 1, periodStart: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'service', subscriptionId: { $type: 'objectId' } },
  }
);
invoiceSchema.index({ issueDate: -1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
