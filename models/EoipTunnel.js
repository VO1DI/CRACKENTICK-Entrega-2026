const mongoose = require('mongoose');

const eoipTunnelSchema = new mongoose.Schema(
  {
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    remoteAddress: { type: String, required: true, trim: true, maxlength: 45 },
    tunnelId: { type: Number, required: true, min: 1, max: 65535 },
    localAddress: { type: String, trim: true, default: '', maxlength: 45 },
    notes: { type: String, trim: true, default: '', maxlength: 300 },
    enabled: { type: Boolean, default: true },
    status: { type: String, enum: ['pending', 'applied', 'error'], default: 'pending' },
    lastResult: { type: String, trim: true, default: '', maxlength: 500 },
    appliedAt: { type: Date },
  },
  { timestamps: true }
);

eoipTunnelSchema.index({ routerId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('EoipTunnel', eoipTunnelSchema);
