const mongoose = require('mongoose');

const trafficDailySchema = new mongoose.Schema(
  {
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
    routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Router', required: true, index: true },
    queueName: { type: String, trim: true, default: '', maxlength: 80 },
    date: { type: Date, required: true },
    rxBytes: { type: Number, default: 0 },
    txBytes: { type: Number, default: 0 },
    samples: { type: Number, default: 0 },
  },
  { timestamps: true }
);

trafficDailySchema.index({ subscriptionId: 1, date: 1 }, { unique: true });
/* Retención: 90 días desde la fecha del registro. */
trafficDailySchema.index({ date: 1 }, { expireAfterSeconds: 90 * 86400 });

module.exports = mongoose.model('TrafficDaily', trafficDailySchema);
