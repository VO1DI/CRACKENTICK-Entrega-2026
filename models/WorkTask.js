const mongoose = require('mongoose');

const ESTADOS_TAREA = ['pending', 'in_progress', 'done', 'cancelled'];
const PRIORIDADES_TAREA = ['low', 'medium', 'high'];

const workTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'El título es obligatorio.'], trim: true, maxlength: 120 },
    description: { type: String, trim: true, default: '', maxlength: 600 },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, min: 15, max: 720, default: 60 },
    priority: { type: String, enum: PRIORIDADES_TAREA, default: 'medium' },
    /* La clave se valida contra los tipos activos en el controlador. */
    category: { type: String, trim: true, default: 'otro', maxlength: 40, index: true },
    status: { type: String, enum: ESTADOS_TAREA, default: 'pending', index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    location: { type: String, trim: true, default: '', maxlength: 160 },
    notes: { type: String, trim: true, default: '', maxlength: 600 },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

workTaskSchema.index({ assignedTo: 1, scheduledAt: 1 });

module.exports = mongoose.model('WorkTask', workTaskSchema);
