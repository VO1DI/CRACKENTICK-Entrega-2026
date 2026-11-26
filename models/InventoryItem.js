const mongoose = require('mongoose');
const { CATEGORIAS_INVENTARIO, TIPOS_INVENTARIO, ESTADOS_SERIAL } = require('../config/constants');

const serialSchema = new mongoose.Schema(
  {
    serial: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    mac: { type: String, trim: true, uppercase: true, default: '', maxlength: 40 },
    status: { type: String, enum: ESTADOS_SERIAL, default: 'available' },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    installedAt: { type: Date },
  },
  { _id: true }
);

const movimientoSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['entrada', 'salida', 'ajuste', 'instalacion', 'venta', 'devolucion'], required: true },
    quantity: { type: Number, required: true },
    reason: { type: String, trim: true, default: '', maxlength: 200 },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    actor: { type: String, trim: true, default: 'admin', maxlength: 80 },
    date: { type: Date, default: Date.now },
  },
  { _id: true }
);

const inventoryItemSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: [true, 'El nombre del artículo es obligatorio.'], trim: true, maxlength: 120 },
    category: { type: String, enum: CATEGORIAS_INVENTARIO, default: 'other', index: true },
    tracking: { type: String, enum: TIPOS_INVENTARIO, default: 'bulk' },
    unit: { type: String, trim: true, default: 'unidad', maxlength: 20 },
    quantity: { type: Number, min: 0, default: 0 },
    minStock: { type: Number, min: 0, default: 0 },
    cost: { type: Number, min: 0, default: 0 },
    price: { type: Number, min: 0, default: 0 },
    location: { type: String, trim: true, default: '', maxlength: 80 },
    supplier: { type: String, trim: true, default: '', maxlength: 120 },
    serials: { type: [serialSchema], default: [] },
    movements: { type: [movimientoSchema], default: [] },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

inventoryItemSchema.virtual('availableSerials').get(function availableSerials() {
  return (this.serials || []).filter((serial) => serial.status === 'available').length;
});

/** Existencias reales: los serializados cuentan sus seriales disponibles. */
inventoryItemSchema.virtual('stock').get(function stock() {
  return this.tracking === 'serial' ? this.availableSerials : this.quantity;
});

inventoryItemSchema.virtual('bajoMinimo').get(function bajoMinimo() {
  return this.stock <= this.minStock;
});

inventoryItemSchema.statics.siguienteCodigo = function siguienteCodigo() {
  return require('../services/counterService').siguiente('inventory');
};

inventoryItemSchema.index(
  { 'serials.serial': 1 },
  { unique: true, partialFilterExpression: { 'serials.serial': { $gt: '' } } }
);

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
