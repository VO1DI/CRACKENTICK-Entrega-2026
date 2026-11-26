const mongoose = require('mongoose');

const permissionPresetSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'El nombre del preset es obligatorio.'], trim: true, unique: true, minlength: 2, maxlength: 60 },
    description: { type: String, trim: true, default: '', maxlength: 200 },
    permissions: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PermissionPreset', permissionPresetSchema);
