const mongoose = require('mongoose');
const { ESTADOS_ALERTA, TIPOS_ALERTA } = require('../config/constants');

const alertSchema = new mongoose.Schema(
  {
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', default: null, index: true },
    routerName: { type: String, trim: true, default: '', maxlength: 80 },
    wan: { type: String, trim: true, default: '', maxlength: 60 },
    type: { type: String, enum: TIPOS_ALERTA, default: 'wan_down', index: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'critical' },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    status: { type: String, enum: ESTADOS_ALERTA, default: 'active', index: true },
    value: { type: String, trim: true, default: '', maxlength: 120 },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null, index: true },
    link: { type: String, trim: true, default: '', maxlength: 200 },
    startedAt: { type: Date, default: Date.now, index: true },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

alertSchema.index({ status: 1, startedAt: -1 });
alertSchema.index({ routerId: 1, wan: 1, status: 1 });

module.exports = mongoose.model('Alert', alertSchema);
