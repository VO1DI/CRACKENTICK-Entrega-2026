const mongoose = require('mongoose');
const { MODULOS_AUDITORIA, ACCIONES_AUDITORIA } = require('../config/constants');

const auditLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now, index: true },
    module: { type: String, enum: MODULOS_AUDITORIA, required: true, index: true },
    entity: { type: String, trim: true, default: '' },
    entityId: { type: String, trim: true, default: '', index: true },
    action: { type: String, enum: ACCIONES_AUDITORIA, required: true, index: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    changes: {
      before: { type: mongoose.Schema.Types.Mixed },
      after: { type: mongoose.Schema.Types.Mixed },
    },
    command: { type: String, trim: true, default: '', maxlength: 2000 },
    commandResult: { type: String, trim: true, default: '', maxlength: 2000 },
    status: { type: String, enum: ['success', 'failed'], default: 'success', index: true },
    durationMs: { type: Number, min: 0 },
    actor: { type: String, trim: true, default: 'system', maxlength: 60 },
    aiModel: { type: String, trim: true, default: '', maxlength: 80 },
    aiAssisted: { type: Boolean, default: false, index: true },
    confirmed: { type: Boolean, default: true },
    confirmedBy: { type: String, trim: true, default: '', maxlength: 60 },
    confirmedAt: { type: Date },
  },
  { timestamps: false, versionKey: false }
);

auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ module: 1, timestamp: -1 });
auditLogSchema.index({ entityId: 1, timestamp: -1 });

// La auditoría es append-only: se bloquean actualizaciones y borrados.
auditLogSchema.pre('findOneAndUpdate', function bloquearUpdate(next) {
  next(new Error('La auditoría es inmutable: no se puede editar.'));
});
auditLogSchema.pre('updateOne', function bloquearUpdateOne(next) {
  next(new Error('La auditoría es inmutable: no se puede editar.'));
});
auditLogSchema.pre('deleteOne', function bloquearDelete(next) {
  next(new Error('La auditoría es inmutable: no se puede borrar.'));
});
auditLogSchema.pre('deleteMany', function bloquearDeleteMany(next) {
  next(new Error('La auditoría es inmutable: no se puede borrar.'));
});
auditLogSchema.pre('updateMany', function bloquearUpdateMany(next) {
  next(new Error('La auditoría es inmutable: no se puede editar.'));
});
auditLogSchema.pre('replaceOne', function bloquearReplaceOne(next) {
  next(new Error('La auditoría es inmutable: no se puede editar.'));
});
auditLogSchema.pre('findOneAndReplace', function bloquearFindOneAndReplace(next) {
  next(new Error('La auditoría es inmutable: no se puede editar.'));
});
auditLogSchema.pre('findOneAndDelete', function bloquearFindOneAndDelete(next) {
  next(new Error('La auditoría es inmutable: no se puede borrar.'));
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
