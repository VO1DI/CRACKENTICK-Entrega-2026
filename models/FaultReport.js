const mongoose = require('mongoose');
const { PRIORIDADES_TICKET, ESTADOS_AVERIA } = require('../config/constants');

const faultReportSchema = new mongoose.Schema(
  {
    zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', default: null, index: true },
    priority: { type: String, enum: PRIORIDADES_TICKET, default: 'medium', index: true },
    faultDate: { type: Date, required: true, default: Date.now, index: true },
    reportedAt: { type: Date, default: Date.now },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    clientName: { type: String, trim: true, default: '', maxlength: 120 },
    problem: { type: String, required: [true, 'El problema es obligatorio.'], trim: true, maxlength: 300 },
    note: { type: String, trim: true, default: '', maxlength: 500 },
    technician: { type: String, trim: true, default: '', maxlength: 80 },
    technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    location: { type: String, trim: true, default: '', maxlength: 200 },
    status: { type: String, enum: ESTADOS_AVERIA, default: 'unsolved', index: true },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null, index: true },
    resolvedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

faultReportSchema.virtual('cliente').get(function cliente() {
  if (this.clientId && this.clientId.firstName) {
    return `${this.clientId.firstName} ${this.clientId.lastName}`.trim();
  }
  return this.clientName || '—';
});

module.exports = mongoose.model('FaultReport', faultReportSchema);
