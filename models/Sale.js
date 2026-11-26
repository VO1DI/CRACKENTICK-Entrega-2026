const mongoose = require('mongoose');
const { ESTADOS_VENTA, TIPOS_CONEXION } = require('../config/constants');

const itemVentaSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    name: { type: String, required: true, trim: true },
    tracking: { type: String, enum: ['bulk', 'serial'], default: 'bulk' },
    unit: { type: String, trim: true, default: 'unidad' },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    unitPrice: { type: Number, required: true, min: 0, default: 0 },
    amount: { type: Number, required: true, min: 0, default: 0 },
    serials: { type: [String], default: [] },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: ESTADOS_VENTA, default: 'waiting', index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
    customer: {
      firstName: { type: String, trim: true, default: '', maxlength: 60 },
      lastName: { type: String, trim: true, default: '', maxlength: 60 },
      taxId: { type: String, trim: true, default: '', maxlength: 40 },
      email: { type: String, trim: true, lowercase: true, default: '', maxlength: 120 },
      phone: { type: String, trim: true, default: '', maxlength: 40 },
      address: { type: String, trim: true, default: '', maxlength: 200 },
      city: { type: String, trim: true, default: '', maxlength: 80 },
      state: { type: String, trim: true, default: '', maxlength: 80 },
    },
    service: {
      planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
      routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', default: null },
      connectionType: { type: String, enum: TIPOS_CONEXION, default: 'pppoe' },
      ipPoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'IpPool', default: null },
      ipAddress: { type: String, trim: true, default: '', maxlength: 45 },
      macAddress: { type: String, trim: true, uppercase: true, default: '', maxlength: 40 },
      macAuthEnabled: { type: Boolean, default: false },
      pppoeUsername: { type: String, trim: true, lowercase: true, default: '', maxlength: 60 },
      pppoePasswordEnc: { type: String, default: '', select: false },
    },
    items: { type: [itemVentaSchema], default: [] },
    materialsTotal: { type: Number, min: 0, default: 0 },
    installationCost: { type: Number, min: 0, default: 0 },
    subtotal: { type: Number, min: 0, default: 0 },
    taxRatePercent: { type: Number, min: 0, max: 100, default: 0 },
    tax: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
    scheduledAt: { type: Date },
    installedAt: { type: Date },
    installStartedAt: { type: Date, default: null },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, default: '', maxlength: 300 },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    promoterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

saleSchema.virtual('clienteNombre').get(function clienteNombre() {
  return this.customer ? `${this.customer.firstName} ${this.customer.lastName}`.trim() : '';
});

saleSchema.index(
  { 'service.macAddress': 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'waiting',
      'service.macAuthEnabled': true,
      'service.macAddress': { $gt: '' },
    },
  }
);

saleSchema.statics.siguienteCodigo = function siguienteCodigo() {
  return require('../services/counterService').siguiente('sale');
};

module.exports = mongoose.model('Sale', saleSchema);
