const mongoose = require('mongoose');
const { ESTADOS_CLIENTE } = require('../config/constants');
const { iniciales } = require('../utils/strings');

const clientSchema = new mongoose.Schema(
  {
    clientCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    firstName: { type: String, required: [true, 'El nombre es obligatorio.'], trim: true, minlength: 2, maxlength: 60 },
    lastName: { type: String, required: [true, 'El apellido es obligatorio.'], trim: true, minlength: 2, maxlength: 60 },
    taxId: { type: String, trim: true, default: '', maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, default: '', maxlength: 120 },
    phone: { type: String, trim: true, default: '', maxlength: 30 },
    address: {
      street: { type: String, trim: true, default: '', maxlength: 160 },
      city: { type: String, trim: true, default: '', maxlength: 80 },
      state: { type: String, trim: true, default: '', maxlength: 80 },
      postalCode: { type: String, trim: true, default: '', maxlength: 20 },
    },
    billingData: {
      legalName: { type: String, trim: true, default: '', maxlength: 160 },
      taxId: { type: String, trim: true, default: '', maxlength: 40 },
      email: { type: String, trim: true, lowercase: true, default: '', maxlength: 120 },
      address: { type: String, trim: true, default: '', maxlength: 200 },
    },
    status: { type: String, enum: ESTADOS_CLIENTE, default: 'active', index: true },
    statusReason: { type: String, enum: ['', 'billing', 'manual'], default: '' },
    portalEnabled: { type: Boolean, default: false, index: true },
    portalTheme: { type: String, enum: ['oscuro', 'claro', 'claro-suave'], default: 'claro-suave' },
    portalPasswordHash: { type: String, select: false },
    portalLastLoginAt: { type: Date },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

clientSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

clientSchema.virtual('initials').get(function initialsVirtual() {
  return iniciales(this.firstName, this.lastName);
});

clientSchema.index({ taxId: 1 }, { unique: true, partialFilterExpression: { taxId: { $gt: '' } } });
clientSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $gt: '' } } });
clientSchema.index({ firstName: 'text', lastName: 'text', clientCode: 'text', email: 'text' });

clientSchema.statics.siguienteCodigo = function siguienteCodigo() {
  return require('../services/counterService').siguiente('client');
};

clientSchema.pre('validate', function normalizar(next) {
  if (this.email) this.email = String(this.email).trim().toLowerCase();
  if (this.billingData?.email) this.billingData.email = String(this.billingData.email).trim().toLowerCase();
  if (this.clientCode) this.clientCode = String(this.clientCode).trim().toUpperCase();
  next();
});

module.exports = mongoose.model('Client', clientSchema);
