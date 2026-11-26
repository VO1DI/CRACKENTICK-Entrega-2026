const mongoose = require('mongoose');
const { INTERVALOS } = require('../config/constants');

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'El nombre del plan es obligatorio.'], trim: true, unique: true, minlength: 3, maxlength: 60 },
    description: { type: String, trim: true, default: '', maxlength: 300 },
    downloadSpeed: {
      type: Number,
      required: [true, 'La velocidad de descarga es obligatoria.'],
      min: [1, 'La velocidad de descarga debe ser mayor que 0.'],
      validate: { validator: Number.isInteger, message: 'La velocidad de descarga debe ser un número entero.' },
    },
    uploadSpeed: {
      type: Number,
      required: [true, 'La velocidad de subida es obligatoria.'],
      min: [1, 'La velocidad de subida debe ser mayor que 0.'],
      validate: { validator: Number.isInteger, message: 'La velocidad de subida debe ser un número entero.' },
    },
    price: {
      type: Number,
      required: [true, 'El precio es obligatorio.'],
      min: [0, 'El precio debe ser mayor o igual a 0.'],
      set: (valor) => Math.round((Number(valor) + Number.EPSILON) * 100) / 100,
    },
    taxRate: {
      type: Number,
      min: [0, 'El IVA del plan no puede ser negativo.'],
      max: [1, 'El IVA del plan no puede superar 100 %.'],
      default: null,
    },
    billingInterval: { type: String, enum: INTERVALOS, default: 'monthly' },
    trafficMode: { type: String, enum: ['simple_queue', 'address_list'], default: 'simple_queue', index: true },
    routerIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Router' }], default: [] },
    parentMaxDownloadMbps: { type: Number, min: 0, default: 0 },
    parentMaxUploadMbps: { type: Number, min: 0, default: 0 },
    parentLimitAtDownloadMbps: { type: Number, min: 0, default: 0 },
    parentLimitAtUploadMbps: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

planSchema.virtual('speedLabel').get(function speedLabel() {
  return `${this.downloadSpeed} / ${this.uploadSpeed} Mbps`;
});

planSchema.virtual('addressListName').get(function addressListName() {
  if (this.trafficMode !== 'address_list') return '';
  const base = String(this.name || 'plan')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `ct-plan-${base}`;
});

planSchema.virtual('snapshot').get(function snapshot() {
  return {
    name: this.name,
    downloadSpeed: this.downloadSpeed,
    uploadSpeed: this.uploadSpeed,
    price: this.price,
    taxRate: this.taxRate ?? null,
    billingInterval: this.billingInterval,
    trafficMode: this.trafficMode || 'simple_queue',
    capturedAt: new Date(),
  };
});

module.exports = mongoose.model('Plan', planSchema);
