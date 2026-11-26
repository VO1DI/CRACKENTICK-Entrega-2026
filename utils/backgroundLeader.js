const crypto = require('node:crypto');
const Lock = require('../models/Lock');

const DURACION_MS = 90 * 1000;
const RENOVACION_MS = 30 * 1000;
let owner = null;
let latido = null;
let activo = false;

/** Reclama el liderazgo de los trabajos programados. Solo una instancia lo obtiene. */
async function intentar() {
  if (activo) return true;
  owner = owner || crypto.randomUUID();
  try {
    const doc = await Lock.findOneAndUpdate(
      { _id: 'background-jobs', $or: [{ expiresAt: { $lt: new Date() } }, { expiresAt: null }] },
      { $set: { owner, expiresAt: new Date(Date.now() + DURACION_MS) } },
      { upsert: true, new: true }
    );
    if (!doc || doc.owner !== owner) return false;
    activo = true;
    if (!latido) {
      latido = setInterval(() => {
        Lock.updateOne(
          { _id: 'background-jobs', owner },
          { $set: { expiresAt: new Date(Date.now() + DURACION_MS) } }
        ).catch(() => null);
      }, RENOVACION_MS);
      if (latido.unref) latido.unref();
    }
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

async function liberar() {
  activo = false;
  if (latido) clearInterval(latido);
  latido = null;
  if (owner) await Lock.deleteOne({ _id: 'background-jobs', owner }).catch(() => null);
}

module.exports = { intentar, liberar };
