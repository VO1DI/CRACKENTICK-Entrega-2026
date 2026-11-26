const mongoose = require('mongoose');
const { ESTADOS_TICKET, PRIORIDADES_TICKET, CATEGORIAS_TICKET } = require('../config/constants');

const mensajeSchema = new mongoose.Schema(
  {
    author: { type: String, trim: true, default: 'Soporte', maxlength: 80 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    internal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ticketSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
    subject: { type: String, required: [true, 'El asunto es obligatorio.'], trim: true, maxlength: 120 },
    description: { type: String, required: [true, 'La descripción es obligatoria.'], trim: true, maxlength: 2000 },
    category: { type: String, enum: CATEGORIAS_TICKET, default: 'technical' },
    priority: { type: String, enum: PRIORIDADES_TICKET, default: 'medium', index: true },
    status: { type: String, enum: ESTADOS_TICKET, default: 'open', index: true },
    assignedTo: { type: String, trim: true, default: 'Soporte', maxlength: 80 },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    messages: { type: [mensajeSchema], default: [] },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

ticketSchema.virtual('totalMensajes').get(function totalMensajes() {
  return this.messages?.length || 0;
});

ticketSchema.virtual('ultimoMensaje').get(function ultimoMensaje() {
  return this.messages?.length ? this.messages[this.messages.length - 1] : null;
});

ticketSchema.virtual('abierto').get(function abierto() {
  return ['open', 'in_progress'].includes(this.status);
});

ticketSchema.statics.siguienteCodigo = function siguienteCodigo() {
  return require('../services/counterService').siguiente('ticket');
};

module.exports = mongoose.model('Ticket', ticketSchema);
