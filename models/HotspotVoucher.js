const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotBatch', required: true, index: true },
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, index: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 30 },
    password: { type: String, required: true, trim: true, maxlength: 30 },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotPlan', default: null, index: true },
    profile: { type: String, trim: true, default: '', maxlength: 60 },
    durationMinutes: { type: Number, min: 0, default: 0 },
    durationHours: { type: Number, min: 0, default: 0 },
    dataLimitMB: { type: Number, min: 0, default: 0 },
    price: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ['available', 'sold', 'revoked', 'expired'], default: 'available', index: true },
    soldAt: { type: Date },
    startedAt: { type: Date },
    expiredAt: { type: Date },
    soldBy: { type: String, trim: true, default: '', maxlength: 60 },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    financeEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinanceEntry', default: null },
    paymentCurrency: { type: String, enum: ['USD', 'VES'], default: 'USD' },
    paymentAmount: { type: Number, min: 0, default: 0 },
    exchangeRate: { type: Number, min: 0, default: 0 },
    amountUsd: { type: Number, min: 0, default: 0 },
    paymentReference: { type: String, trim: true, default: '', maxlength: 80 },
    notes: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true }
);

voucherSchema.index({ routerId: 1, status: 1 });

module.exports = mongoose.model('HotspotVoucher', voucherSchema);
