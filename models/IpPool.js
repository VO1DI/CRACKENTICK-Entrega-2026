const mongoose = require('mongoose');
const { PROPOSITOS_POOL } = require('../config/constants');
const { analizarCidr } = require('../utils/ip');

const ipPoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'El nombre del pool es obligatorio.'], trim: true, maxlength: 60 },
    cidr: { type: String, required: [true, 'El bloque CIDR es obligatorio.'], trim: true, maxlength: 40 },
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', default: null, index: true },
    purpose: { type: String, enum: PROPOSITOS_POOL, default: 'mixed' },
    autoProvision: { type: Boolean, default: true },
    appliedAt: { type: Date },
    lastApplyResult: { type: String, trim: true, default: '', maxlength: 500 },
    active: { type: Boolean, default: true },
    notes: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

ipPoolSchema.virtual('datos').get(function datos() {
  return analizarCidr(this.cidr);
});

ipPoolSchema.virtual('network').get(function network() {
  return this.datos?.network || '';
});
ipPoolSchema.virtual('prefix').get(function prefix() {
  return this.datos?.prefix ?? null;
});
ipPoolSchema.virtual('usable').get(function usable() {
  return this.datos?.usable || 0;
});
ipPoolSchema.virtual('firstUsable').get(function firstUsable() {
  return this.datos?.firstUsable || '';
});
ipPoolSchema.virtual('lastUsable').get(function lastUsable() {
  return this.datos?.lastUsable || '';
});
ipPoolSchema.virtual('rangeLabel').get(function rangeLabel() {
  return this.datos ? `${this.datos.firstUsable} – ${this.datos.lastUsable}` : '';
});

ipPoolSchema.index({ routerId: 1, name: 1 }, { unique: true });

ipPoolSchema.pre('validate', function validarCidr(next) {
  const datos = analizarCidr(this.cidr);
  if (!datos.ok) {
    this.invalidate('cidr', datos.error);
  } else if (this.isModified('cidr')) {
    this.cidr = `${datos.network}/${datos.prefix}`;
  }
  next();
});

module.exports = mongoose.model('IpPool', ipPoolSchema);
