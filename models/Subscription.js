const mongoose = require('mongoose');
const { ESTADOS_SUSCRIPCION, ESTADOS_FIREWALL, TIPOS_CONEXION } = require('../config/constants');

const planSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    downloadSpeed: { type: Number, required: true },
    uploadSpeed: { type: Number, required: true },
    price: { type: Number, required: true },
    taxRate: { type: Number, min: 0, max: 1, default: null },
    billingInterval: { type: String, required: true },
    trafficMode: { type: String, enum: ['simple_queue', 'address_list'], default: 'simple_queue' },
    capturedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, unique: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    planSnapshot: { type: planSnapshotSchema, required: true },
    serviceConfig: {
      connectionType: { type: String, enum: TIPOS_CONEXION, required: true, default: 'pppoe' },
      ipAddress: { type: String, trim: true, default: '', maxlength: 45 },
      macAddress: { type: String, trim: true, uppercase: true, default: '', maxlength: 40 },
      macAuthEnabled: { type: Boolean, default: false },
      pppoeUsername: { type: String, trim: true, lowercase: true, default: '', maxlength: 60 },
      pppoePasswordEnc: { type: String, default: '', select: false },
      routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', default: null, index: true },
      ipPoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'IpPool', default: null },
      queueName: { type: String, trim: true, default: '', maxlength: 80 },
      provisioningState: { type: String, enum: ['none', 'ok', 'error'], default: 'none' },
      provisionedAt: { type: Date },
      lastProvisionResult: { type: String, trim: true, default: '', maxlength: 500 },
    },
    status: { type: String, enum: ESTADOS_SUSCRIPCION, default: 'active', index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null, index: true },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true, index: true },
    installedAt: { type: Date },
    firewallState: { type: String, enum: ESTADOS_FIREWALL, default: 'none', index: true },
    firewallBlockedAt: { type: Date },
    pppoeDisabled: { type: Boolean, default: false },
    lastStatusChangeAt: { type: Date },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

subscriptionSchema.virtual('planName').get(function planName() {
  return this.planSnapshot?.name || 'Sin plan';
});

subscriptionSchema.index(
  { 'serviceConfig.pppoeUsername': 1 },
  { unique: true, partialFilterExpression: { 'serviceConfig.pppoeUsername': { $gt: '' } } }
);
subscriptionSchema.index(
  { 'serviceConfig.ipAddress': 1 },
  { unique: true, partialFilterExpression: { 'serviceConfig.ipAddress': { $gt: '' } } }
);
subscriptionSchema.index(
  { 'serviceConfig.macAddress': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'serviceConfig.macAuthEnabled': true,
      'serviceConfig.macAddress': { $gt: '' },
    },
  }
);

subscriptionSchema.pre('validate', function validarConexion(next) {
  const config = this.serviceConfig || {};
  if (config.connectionType === 'pppoe' && !config.pppoeUsername) {
    this.invalidate('serviceConfig.pppoeUsername', 'El usuario PPPoE es obligatorio para este tipo de conexión.');
  }
  if (['static', 'dhcp'].includes(config.connectionType) && !config.ipAddress) {
    this.invalidate('serviceConfig.ipAddress', 'La dirección IP es obligatoria para este tipo de conexión.');
  }
  const ipv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  if (config.ipAddress && !ipv4.test(config.ipAddress)) {
    this.invalidate('serviceConfig.ipAddress', 'La dirección IP no es válida.');
  }
  next();
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
