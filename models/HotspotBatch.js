const mongoose = require('mongoose');

const hotspotBatchSchema = new mongoose.Schema(
  {
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, index: true },
    routerName: { type: String, trim: true, default: '', maxlength: 60 },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotPlan', default: null, index: true },
    profile: { type: String, trim: true, required: true, maxlength: 60 },
    durationMinutes: { type: Number, min: 0, default: 0 },
    quantity: { type: Number, required: true, min: 1 },
    durationHours: { type: Number, min: 0, default: 0 },
    dataLimitMB: { type: Number, min: 0, default: 0 },
    price: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ['complete', 'incomplete'], default: 'complete' },
    lastErrors: { type: [String], default: [] },
    createdBy: { type: String, trim: true, default: 'admin', maxlength: 60 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('HotspotBatch', hotspotBatchSchema);
