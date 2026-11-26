const mongoose = require('mongoose');

const firewallRuleSchema = new mongoose.Schema(
  {
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, index: true },
    chain: { type: String, enum: ['input', 'forward'], default: 'forward' },
    action: { type: String, enum: ['accept', 'drop', 'reject'], default: 'drop' },
    protocol: { type: String, enum: ['', 'tcp', 'udp', 'icmp'], default: '' },
    port: { type: Number, min: 1, max: 65535, default: null },
    srcAddress: { type: String, trim: true, default: '', maxlength: 45 },
    comment: { type: String, trim: true, default: '', maxlength: 120 },
    enabled: { type: Boolean, default: true },
    status: { type: String, enum: ['pending', 'applied', 'error'], default: 'pending' },
    lastResult: { type: String, trim: true, default: '', maxlength: 500 },
    appliedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FirewallRule', firewallRuleSchema);
