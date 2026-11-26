const mongoose = require('mongoose');

const vlanSchema = new mongoose.Schema(
  {
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, index: true },
    vlanId: { type: Number, required: true, min: 1, max: 4094 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    interface: { type: String, trim: true, default: '', maxlength: 60 },
    address: { type: String, trim: true, default: '', maxlength: 45 },
    enabled: { type: Boolean, default: true },
    notes: { type: String, trim: true, default: '', maxlength: 300 },
    status: { type: String, enum: ['pending', 'applied', 'error'], default: 'pending' },
    lastResult: { type: String, trim: true, default: '', maxlength: 500 },
    appliedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

vlanSchema.index({ routerId: 1, vlanId: 1 }, { unique: true });

module.exports = mongoose.model('Vlan', vlanSchema);
