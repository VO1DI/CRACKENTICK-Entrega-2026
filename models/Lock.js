const mongoose = require('mongoose');

const lockSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { versionKey: false }
);

module.exports = mongoose.model('Lock', lockSchema);
