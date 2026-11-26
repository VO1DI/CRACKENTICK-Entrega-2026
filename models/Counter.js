const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0, min: 0 },
  },
  { versionKey: false }
);

/** Reserva el siguiente número de forma atómica. */
counterSchema.statics.siguiente = async function siguiente(key) {
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      const documento = await this.findOneAndUpdate(
        { key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      return documento.seq;
    } catch (error) {
      if (error.code !== 11000 || intento === 1) throw error;
    }
  }
  return 0;
};

module.exports = mongoose.model('Counter', counterSchema);
