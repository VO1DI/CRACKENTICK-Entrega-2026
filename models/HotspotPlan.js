const mongoose = require('mongoose');

const hotspotPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'El nombre del plan es obligatorio.'], trim: true, maxlength: 60 },
    price: { type: Number, min: 0, default: 0 },
    durationMinutes: { type: Number, min: 0, default: 60 },
    downloadMbps: { type: Number, min: 0, default: 0 },
    uploadMbps: { type: Number, min: 0, default: 0 },
    dataLimitMB: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

hotspotPlanSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('HotspotPlan', hotspotPlanSchema);
