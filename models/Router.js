const mongoose = require('mongoose');
const { MODOS_FIREWALL } = require('../config/constants');

const wanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    provider: { type: String, trim: true, default: '', maxlength: 80 },
    downloadMbps: { type: Number, min: 0, default: 0 },
    uploadMbps: { type: Number, min: 0, default: 0 },
    notes: { type: String, trim: true, default: '', maxlength: 200 },
  },
  { _id: false }
);

const routerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre del router es obligatorio.'],
      trim: true,
      unique: true,
      minlength: 3,
      maxlength: 60,
    },
    description: { type: String, trim: true, default: '', maxlength: 200 },
    vendor: { type: String, enum: ['mikrotik', 'cisco'], default: 'mikrotik', index: true },
    model: { type: String, trim: true, default: '', maxlength: 80 },
    mode: { type: String, enum: MODOS_FIREWALL, default: 'real' },
    host: { type: String, trim: true, default: '', maxlength: 120 },
    port: { type: Number, min: 1, max: 65535, default: 8728 },
    sshPort: { type: Number, min: 1, max: 65535, default: 22 },
    username: { type: String, trim: true, default: '', maxlength: 80 },
    passwordEnc: { type: String, default: '', select: false },
    enablePasswordEnc: { type: String, default: '', select: false },
    tls: { type: Boolean, default: false },
    verifyTls: { type: Boolean, default: false },
    /* API es el modo normal; SSH queda para emergencias (API bloqueada o caída). */
    transport: { type: String, enum: ['api', 'ssh'], default: 'api', index: true },
    hotspotEnabled: { type: Boolean, default: false, index: true },
    hotspotServer: { type: String, trim: true, default: '', maxlength: 60 },
    hotspotProfile: { type: String, trim: true, default: '', maxlength: 60 },
    active: { type: Boolean, default: true, index: true },
    planMode: { type: String, enum: ['simple_queue', 'address_list'], default: 'simple_queue', index: true },
    contractedDownloadMbps: { type: Number, min: 0, default: 0 },
    contractedUploadMbps: { type: Number, min: 0, default: 0 },
    mangleChain: { type: String, enum: ['forward', 'prerouting'], default: 'forward' },
    queueParent: { type: String, trim: true, default: 'global', maxlength: 60 },
    wanInterfaces: { type: [wanSchema], default: [] },
    lastTestAt: { type: Date },
    lastTestOk: { type: Boolean },
    lastTestResult: { type: String, trim: true, default: '', maxlength: 500 },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

routerSchema.virtual('wanCount').get(function wanCount() {
  return this.wanInterfaces ? this.wanInterfaces.length : 0;
});

module.exports = mongoose.model('Router', routerSchema);
