const mongoose = require('mongoose');

const taskTypeSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z0-9_]+$/, 'La clave solo admite letras minúsculas, números y guion bajo.'],
      maxlength: 40,
    },
    name: { type: String, required: [true, 'El nombre del tipo es obligatorio.'], trim: true, minlength: 2, maxlength: 60 },
    description: { type: String, trim: true, default: '', maxlength: 200 },
    color: {
      type: String,
      required: true,
      default: '#94a3b8',
      match: [/^#[0-9a-fA-F]{6}$/, 'El color debe tener el formato #RRGGBB.'],
    },
    active: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0, min: 0, max: 999 },
  },
  { timestamps: true }
);

taskTypeSchema.index({ order: 1, name: 1 });

module.exports = mongoose.model('TaskType', taskTypeSchema);
