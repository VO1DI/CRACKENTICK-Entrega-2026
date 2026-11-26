const mongoose = require('mongoose');
const { AREAS_EMPLEADO, METODOS_PAGO, MONEDAS_PAGO } = require('../config/constants');

const employeeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre del trabajador es obligatorio.'],
      trim: true,
      maxlength: 120,
    },
    position: {
      type: String,
      required: [true, 'El cargo es obligatorio.'],
      trim: true,
      maxlength: 80,
    },
    area: {
      type: String,
      enum: AREAS_EMPLEADO,
      default: 'administracion',
      index: true,
    },
    salary: {
      type: Number,
      required: [true, 'El sueldo quincenal es obligatorio.'],
      min: [0, 'El sueldo no puede ser negativo.'],
    },
    currency: { type: String, enum: MONEDAS_PAGO, default: 'USD' },
    paymentMethod: { type: String, enum: METODOS_PAGO, default: 'transfer' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    active: { type: Boolean, default: true, index: true },
    startDate: { type: Date, default: Date.now },
    email: { type: String, trim: true, lowercase: true, default: '', maxlength: 120 },
    phone: { type: String, trim: true, default: '', maxlength: 40 },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

module.exports = mongoose.model('Employee', employeeSchema);
