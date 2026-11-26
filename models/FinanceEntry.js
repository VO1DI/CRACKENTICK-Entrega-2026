const mongoose = require('mongoose');
const {
  TIPOS_MOVIMIENTO_FINANZAS,
  CATEGORIAS_FINANZAS,
  ESTADOS_MOVIMIENTO_FINANZAS,
  METODOS_PAGO,
  MONEDAS_PAGO,
} = require('../config/constants');

const financeEntrySchema = new mongoose.Schema(
  {
    type: { type: String, enum: TIPOS_MOVIMIENTO_FINANZAS, default: 'expense', index: true },
    category: { type: String, enum: CATEGORIAS_FINANZAS, default: 'otros', index: true },
    concept: {
      type: String,
      required: [true, 'El concepto es obligatorio.'],
      trim: true,
      maxlength: 160,
    },
    amount: {
      type: Number,
      required: [true, 'El monto es obligatorio.'],
      min: [0, 'El monto no puede ser negativo.'],
    },
    currency: { type: String, enum: MONEDAS_PAGO, default: 'USD', uppercase: true, trim: true },
    // Obligatorio en ingresos; en gastos queda vacío si no se indica.
    paymentMethod: { type: String, enum: [...METODOS_PAGO, ''], default: '' },
    exchangeRate: { type: Number, min: 0, default: 0 },
    amountUsd: { type: Number, min: 0, default: 0 },
    date: { type: Date, default: Date.now, index: true },
    recurring: { type: Boolean, default: false },
    vendor: { type: String, trim: true, default: '', maxlength: 120 },
    status: { type: String, enum: ESTADOS_MOVIMIENTO_FINANZAS, default: 'paid', index: true },
    reference: { type: String, trim: true, default: '', maxlength: 80 },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    payrollPeriod: { type: String, trim: true, default: '', maxlength: 20 },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
    createdBy: { type: String, trim: true, default: 'admin', maxlength: 60 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

financeEntrySchema.index({ type: 1, date: -1 });
financeEntrySchema.index({ category: 1, date: -1 });
financeEntrySchema.index(
  { employeeId: 1, payrollPeriod: 1 },
  { unique: true, partialFilterExpression: { employeeId: { $type: 'objectId' }, payrollPeriod: { $gt: '' } } }
);

financeEntrySchema.path('paymentMethod').validate(function metodoObligatorio(valor) {
  return this.type !== 'income' || Boolean(valor);
}, 'Los ingresos deben indicar el método de pago.');

module.exports = mongoose.model('FinanceEntry', financeEntrySchema);
