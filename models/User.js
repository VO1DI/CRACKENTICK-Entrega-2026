const mongoose = require('mongoose');
const { ROLES_USUARIO, ADMIN_PRINCIPAL } = require('../config/constants');
const { hashPassword, verifyPassword } = require('../utils/password');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio.'],
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    username: {
      type: String,
      required: [true, 'El usuario de inicio de sesión es obligatorio.'],
      trim: true,
      lowercase: true,
      unique: true,
      minlength: 3,
      maxlength: 40,
      match: [/^[a-z0-9._-]+$/, 'El usuario solo admite letras, números, punto, guion y guion bajo.'],
    },
    email: { type: String, trim: true, lowercase: true, default: '', maxlength: 120 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES_USUARIO, default: 'staff', index: true },
    permissions: { type: [String], default: [] },
    sessionVersion: { type: Number, default: 0 },
    theme: { type: String, enum: ['oscuro', 'claro', 'claro-suave'], default: 'oscuro' },
    active: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.virtual('initials').get(function initials() {
  return String(this.name || this.username || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0].toUpperCase())
    .join('');
});

userSchema.virtual('esAdmin').get(function esAdmin() {
  return this.role === 'admin';
});

// La cuenta `admin` conserva siempre la identidad de Juan Echenique.
userSchema.pre('save', function fijarNombreAdmin(next) {
  if (this.username === ADMIN_PRINCIPAL.username) {
    this.name = ADMIN_PRINCIPAL.name;
  }
  next();
});

/** Corrige el nombre del administrador principal en bases ya existentes. */
userSchema.statics.sincronizarAdminPrincipal = function sincronizarAdminPrincipal() {
  return this.updateOne(
    { username: ADMIN_PRINCIPAL.username },
    { $set: { name: ADMIN_PRINCIPAL.name } }
  );
};

userSchema.methods.establecerPassword = function establecerPassword(password) {
  this.passwordHash = hashPassword(password);
  return this;
};

userSchema.methods.verificarPassword = function verificarPassword(password) {
  return verifyPassword(password, this.passwordHash);
};

userSchema.methods.tienePermiso = function tienePermiso(clave) {
  if (this.role === 'admin') return true;
  return (this.permissions || []).includes(clave) || (this.permissions || []).includes(`${clave}:read`);
};

module.exports = mongoose.model('User', userSchema);
