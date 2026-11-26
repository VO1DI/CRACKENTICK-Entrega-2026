const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'El nombre de la zona es obligatorio.'], trim: true, maxlength: 60, unique: true },
    description: { type: String, trim: true, default: '', maxlength: 200 },
    active: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Zone', zoneSchema);
