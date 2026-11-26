const mongoose = require('mongoose');
const { MONEDAS, MONEDA_POR_DEFECTO, LOCALE_POR_DEFECTO, ZONA_POR_DEFECTO, MODOS_FIREWALL } = require('../config/constants');

const codigosMoneda = MONEDAS.map((moneda) => moneda.code);

const telegramBotSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '', maxlength: 60 },
  botTokenEnc: { type: String, default: '', select: false },
  chatId: { type: String, trim: true, default: '', maxlength: 80 },
  categories: {
    type: [{ type: String, enum: ['red', 'servicios', 'almacen'] }],
    default: [],
  },
});

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'system', immutable: true },
    company: {
      name: { type: String, trim: true, default: 'CRACKENTICK', maxlength: 120 },
      taxId: { type: String, trim: true, default: '', maxlength: 40 },
      address: { type: String, trim: true, default: '', maxlength: 200 },
      phone: { type: String, trim: true, default: '', maxlength: 40 },
      email: { type: String, trim: true, lowercase: true, default: '', maxlength: 120 },
    },
    billing: {
      currency: {
        type: String,
        uppercase: true,
        enum: codigosMoneda,
        default: MONEDA_POR_DEFECTO,
      },
      locale: { type: String, trim: true, default: LOCALE_POR_DEFECTO, maxlength: 20 },
      timezone: { type: String, trim: true, default: ZONA_POR_DEFECTO, maxlength: 60 },
      taxRate: { type: Number, min: 0, max: 1, default: 0 },
      taxEnabled: { type: Boolean, default: true },
      invoicePrefix: { type: String, trim: true, uppercase: true, default: 'INV', maxlength: 10 },
      dueDays: { type: Number, min: 0, max: 120, default: 5 },
      graceDays: { type: Number, min: 0, max: 120, default: 3 },
      previewDays: { type: Number, min: 0, max: 60, default: 5 },
      nextInvoiceNumber: { type: Number, min: 1, default: 1 },
      bcvRate: { type: Number, min: 0, default: 0 },
      bcvUpdatedAt: { type: Date, default: null },
      bcvSource: { type: String, trim: true, default: '', maxlength: 40 },
    },
    firewall: {
      mode: { type: String, enum: MODOS_FIREWALL, default: 'real' },
      host: { type: String, trim: true, default: '', maxlength: 120 },
      port: { type: Number, min: 1, max: 65535, default: 8728 },
      username: { type: String, trim: true, default: '', maxlength: 80 },
      passwordEnc: { type: String, default: '', select: false },
      tls: { type: Boolean, default: false },
      verifyTls: { type: Boolean, default: false },
      routerName: { type: String, trim: true, default: 'principal', maxlength: 60 },
    },
    ai: {
      enabled: { type: Boolean, default: false },
      baseUrl: { type: String, trim: true, default: 'https://api.openai.com/v1', maxlength: 200 },
      apiKeyEnc: { type: String, default: '', select: false },
      model: { type: String, trim: true, default: 'gpt-4o-mini', maxlength: 80 },
      models: { type: [String], default: [] },
      braveApiKeyEnc: { type: String, default: '', select: false },
    },
    backup: {
      enabled: { type: Boolean, default: true },
      remote: { type: String, trim: true, default: 'gdrive', maxlength: 60 },
      folder: { type: String, trim: true, default: 'CRACKENTICK-RESPALDOS', maxlength: 120 },
      dayOfWeek: { type: Number, min: 0, max: 6, default: 0 },
      hour: { type: Number, min: 0, max: 23, default: 3 },
      lastRunAt: { type: Date, default: null },
      lastResult: { type: String, trim: true, default: '', maxlength: 300 },
      lastFile: { type: String, trim: true, default: '', maxlength: 300 },
    },
    notifications: {
      telegram: {
        enabled: { type: Boolean, default: false },
        botTokenEnc: { type: String, default: '', select: false },
        chatId: { type: String, trim: true, default: '', maxlength: 80 },
        bots: { type: [telegramBotSchema], default: [] },
      },
    },
    monitoring: {
      intervalMs: { type: Number, min: 2000, max: 300000, default: 5000 },
      downDelayMs: { type: Number, min: 0, max: 3600000, default: 0 },
      icmpEnabled: { type: Boolean, default: false },
      icmpTimeoutMs: { type: Number, min: 500, max: 10000, default: 2000 },
    },
  },
  { timestamps: true }
);

settingsSchema.statics.getSingleton = async function getSingleton() {
  return this.findOneAndUpdate(
    { key: 'system' },
    { $setOnInsert: { key: 'system' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

settingsSchema.methods.resumenFirewall = function resumenFirewall() {
  return {
    mode: this.firewall.mode,
    host: this.firewall.host,
    port: this.firewall.port,
    username: this.firewall.username,
    tls: this.firewall.tls,
    routerName: this.firewall.routerName,
    passwordConfigured: Boolean(this.firewall.passwordEnc),
  };
};

module.exports = mongoose.model('Settings', settingsSchema);
