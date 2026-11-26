const session = require('express-session');
const mongoose = require('mongoose');

/**
 * Sesiones en MongoDB. Evita MemoryStore: las sesiones sobreviven al reinicio
 * y se comparten si algún día se levantan varias instancias.
 */
class MongoSessionStore extends session.Store {
  constructor({ ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;
  }

  coleccion() {
    return mongoose.connection.collection('sessions');
  }

  async asegurarIndice() {
    if (this.indiceListo) return;
    this.indiceListo = true;
    await this.coleccion().createIndex({ expires: 1 }, { expireAfterSeconds: 0 }).catch(() => null);
  }

  async get(sid, callback) {
    try {
      const doc = await this.coleccion().findOne({ _id: sid });
      if (!doc) return callback(null, null);
      if (doc.expires && doc.expires.getTime() < Date.now()) {
        await this.coleccion().deleteOne({ _id: sid }).catch(() => null);
        return callback(null, null);
      }
      try {
        return callback(null, JSON.parse(doc.session));
      } catch (error) {
        await this.coleccion().deleteOne({ _id: sid }).catch(() => null);
        return callback(null, null);
      }
    } catch (error) {
      return callback(error);
    }
  }

  async set(sid, datos, callback) {
    try {
      await this.asegurarIndice();
      await this.coleccion().replaceOne(
        { _id: sid },
        { session: JSON.stringify(datos), expires: new Date(Date.now() + this.ttlMs) },
        { upsert: true }
      );
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.coleccion().deleteOne({ _id: sid });
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  async touch(sid, datos, callback) {
    try {
      await this.coleccion().updateOne(
        { _id: sid },
        { $set: { expires: new Date(Date.now() + this.ttlMs) } }
      );
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }
}

module.exports = MongoSessionStore;
