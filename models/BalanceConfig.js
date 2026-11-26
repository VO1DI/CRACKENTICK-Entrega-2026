const mongoose = require('mongoose');

const wanBalanceSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '', maxlength: 80 },
    gateway: { type: String, required: true, trim: true, maxlength: 45 },
    interface: { type: String, trim: true, default: '', maxlength: 60 },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const balanceConfigSchema = new mongoose.Schema(
  {
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, unique: true, index: true },
    method: { type: String, enum: ['pcc', 'ecmp'], default: 'ecmp' },
    lanInterface: { type: String, trim: true, default: '', maxlength: 60 },
    entries: { type: [wanBalanceSchema], default: [] },
    enabled: { type: Boolean, default: true },
    status: { type: String, enum: ['pending', 'applied', 'error'], default: 'pending' },
    lastResult: { type: String, trim: true, default: '', maxlength: 500 },
    appliedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BalanceConfig', balanceConfigSchema);
