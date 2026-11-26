const mongoose = require('mongoose');

const installationReportSchema = new mongoose.Schema(
  {
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    clientName: { type: String, trim: true, default: '', maxlength: 120 },
    planName: { type: String, trim: true, default: '', maxlength: 80 },
    macAddress: { type: String, trim: true, uppercase: true, default: '', maxlength: 40 },
    macAuthEnabled: { type: Boolean, default: false },
    zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', default: null, index: true },
    technician: { type: String, trim: true, default: '', maxlength: 80 },
    technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    installedAt: { type: Date, default: Date.now, index: true },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

installationReportSchema.index(
  { saleId: 1 },
  { unique: true, partialFilterExpression: { saleId: { $type: 'objectId' } } }
);

module.exports = mongoose.model('InstallationReport', installationReportSchema);
