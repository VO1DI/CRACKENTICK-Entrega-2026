const mongoose = require('mongoose');

const routerBackupSchema = new mongoose.Schema(
  {
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, index: true },
    routerName: { type: String, trim: true, default: '', maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    format: { type: String, enum: ['rsc', 'ios', 'backup', 'api'], default: 'rsc' },
    size: { type: Number, default: 0 },
    content: { type: String, default: '' },
    binary: { type: Buffer },
    simulated: { type: Boolean, default: false },
    actor: { type: String, trim: true, default: 'system', maxlength: 60 },
  },
  { timestamps: true }
);

routerBackupSchema.index({ routerId: 1, createdAt: -1 });

module.exports = mongoose.model('RouterBackup', routerBackupSchema);
