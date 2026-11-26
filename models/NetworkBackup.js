const mongoose = require('mongoose');

const networkBackupSchema = new mongoose.Schema(
  {
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, index: true },
    routerName: { type: String, trim: true, default: '', maxlength: 60 },
    kind: { type: String, trim: true, default: 'experimental', maxlength: 40 },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    actor: { type: String, trim: true, default: 'system', maxlength: 60 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NetworkBackup', networkBackupSchema);
