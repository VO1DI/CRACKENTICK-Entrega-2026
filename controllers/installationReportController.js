const mongoose = require('mongoose');
const InstallationReport = require('../models/InstallationReport');
const Zone = require('../models/Zone');
const User = require('../models/User');
const Client = require('../models/Client');
const Plan = require('../models/Plan');
const reportService = require('../services/reportService');
const staffService = require('../services/staffService');
const { registrar } = require('../services/auditService');
const { crearError } = require('../utils/errors');
const { normalizarErrores } = require('../utils/formErrors');
const { fechaLocal, inicioDelDia, finDelDia } = require('../utils/dates');
const { normalizarMac } = require('../utils/mac');

function fechaISO(fecha) {
  const valor = fecha ? new Date(fecha) : new Date();
  return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`;
}

function hoyISO() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function fechaDelFiltro(valor) {
  const texto = String(valor || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : hoyISO();
}

function fechaDeCampo(valor, respaldo = null) {
  if (!valor) return respaldo;
  const fecha = fechaLocal(valor);
  return Number.isNaN(fecha.getTime()) ? respaldo : fecha;
}

/** GET /red/reportes/instalaciones */
async function index(req, res, next) {
  try {
    await reportService.sincronizarInstalaciones();

    const fecha = fechaDelFiltro(req.query.fecha);
    const zonaFiltro = String(req.query.zona || '');
    const desde = inicioDelDia(fecha);
    const hasta = finDelDia(fecha);

    const consulta = { installedAt: { $gte: desde, $lte: hasta } };
    if (zonaFiltro === 'sin') consulta.zoneId = null;
    else if (mongoose.isValidObjectId(zonaFiltro)) consulta.zoneId = zonaFiltro;

    const [zonas, reportes] = await Promise.all([
      Zone.find().sort({ order: 1, name: 1 }).lean(),
      InstallationReport.find(consulta)
        .populate('clientId')
        .populate('zoneId')
        .populate('saleId')
        .sort({ installedAt: 1 })
        .lean(),
    ]);

    const mapaZonas = new Map(
      zonas.map((zona) => [String(zona._id), { _id: String(zona._id), nombre: zona.name, activa: zona.active, reportes: [] }])
    );
    const sinZona = { _id: null, nombre: 'Sin zona', activa: true, reportes: [] };

    reportes.forEach((reporte) => {
      const clave = reporte.zoneId ? String(reporte.zoneId._id || reporte.zoneId) : null;
      const grupo = (clave && mapaZonas.get(clave)) || sinZona;
      grupo.reportes.push(reporte);
    });

    const grupos = [...mapaZonas.values()].filter((zona) => zona.activa || zona.reportes.length);
    if (sinZona.reportes.length) grupos.push(sinZona);

    res.render('reports/installations', {
      titulo: 'Reporte de instalaciones',
      fecha,
      filtros: { fecha, zona: zonaFiltro },
      zonas,
      grupos,
      resumen: {
        total: reportes.length,
        conZona: reportes.filter((r) => r.zoneId).length,
        sinZona: reportes.filter((r) => !r.zoneId).length,
      },
    });
  } catch (error) {
    next(error);
  }
}

/** Opciones compartidas por el formulario de instalación. */
async function cargarOpciones() {
  const [zonas, usuarios, clientes, planes] = await Promise.all([
    Zone.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
    User.find({ active: true }).select('name').sort({ name: 1 }).lean(),
    Client.find({ status: { $ne: 'retired' } })
      .select('clientCode firstName lastName')
      .sort({ firstName: 1, lastName: 1 })
      .lean(),
    Plan.find({ active: true }).select('name').sort({ name: 1 }).lean(),
  ]);
  return { zonas, tecnicos: usuarios.map((u) => u.name), clientes, planes };
}

/** GET /red/reportes/instalaciones/nueva */
async function formNuevo(req, res, next) {
  try {
    const opciones = await cargarOpciones();
    res.render('reports/installation-form', {
      titulo: 'Nueva instalación',
      modo: 'crear',
      reporte: {
        clientId: null,
        clientName: '',
        planName: '',
        zoneId: null,
        technician: '',
        installedAt: new Date(),
        notes: '',
      },
      zonas: opciones.zonas,
      tecnicos: opciones.tecnicos,
      clientes: opciones.clientes,
      planes: opciones.planes,
      errores: [],
      erroresCampo: {},
      valores: {},
    });
  } catch (error) {
    next(error);
  }
}

/** POST /red/reportes/instalaciones */
async function crear(req, res, next) {
  const opciones = await cargarOpciones().catch(() => ({ zonas: [], tecnicos: [], clientes: [], planes: [] }));
  const reenviar = (error, status = 422) => {
    const { lista, campos } = normalizarErrores(error);
    return res.status(status).render('reports/installation-form', {
      titulo: 'Nueva instalación',
      modo: 'crear',
      reporte: {
        clientId: req.body.clientId || null,
        clientName: '',
        planName: '',
        zoneId: req.body.zoneId || null,
        technician: req.body.technician || '',
        installedAt: fechaLocal(req.body.installedAt) || new Date(),
        macAddress: normalizarMac(req.body.macAddress),
        macAuthEnabled: req.body.macAuthEnabled === 'on' || req.body.macAuthEnabled === 'true',
        notes: req.body.notes || '',
        planId: req.body.planId || null,
      },
      zonas: opciones.zonas,
      tecnicos: opciones.tecnicos,
      clientes: opciones.clientes,
      planes: opciones.planes,
      errores: lista,
      erroresCampo: campos,
      valores: req.body,
    });
  };

  try {
    if (!mongoose.isValidObjectId(req.body.clientId)) {
      throw crearError(422, 'Selecciona el cliente de la instalación.');
    }
    const cliente = await Client.findById(req.body.clientId).lean();
    if (!cliente) throw crearError(422, 'El cliente seleccionado no existe.');

    const plan = mongoose.isValidObjectId(req.body.planId) ? await Plan.findById(req.body.planId).lean() : null;
    const tecnico = String(req.body.technician || '').trim().slice(0, 80);
    const macRaw = String(req.body.macAddress || '').trim().toUpperCase();
    const mac = normalizarMac(macRaw);
    const macAuth = req.body.macAuthEnabled === 'on' || req.body.macAuthEnabled === 'true';
    if (macRaw && !mac) throw crearError(422, 'La MAC no es válida. Usa el formato AA:BB:CC:DD:EE:FF.');
    if (macAuth && !mac) throw crearError(422, 'La autenticación por MAC necesita una MAC.');
    const reporte = await InstallationReport.create({
      saleId: null,
      clientId: cliente._id,
      clientName: `${cliente.firstName || ''} ${cliente.lastName || ''}`.trim(),
      planName: plan ? plan.name : '',
      zoneId: mongoose.isValidObjectId(req.body.zoneId) ? req.body.zoneId : null,
      technician: tecnico,
      technicianId: await staffService.usuarioPorNombre(tecnico),
      installedAt: fechaDeCampo(req.body.installedAt, new Date()),
      macAddress: mac,
      macAuthEnabled: macAuth,
      notes: String(req.body.notes || '').trim().slice(0, 500),
    });

    await registrar({
      module: 'technical',
      entity: 'InstallationReport',
      entityId: reporte._id,
      action: 'create',
      description: `Instalación registrada para ${reporte.clientName || 'cliente'} (${fechaISO(reporte.installedAt)}).`,
      actor: req.usuario ? req.usuario.username : 'admin',
    });

    req.flash('exito', 'Instalación agregada al reporte.');
    res.redirect(`/red/reportes/instalaciones?fecha=${fechaISO(reporte.installedAt)}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      return reenviar(error, error.status || 422);
    }
    next(error);
  }
}

/** GET /red/reportes/instalaciones/:id/editar */
async function formEditar(req, res, next) {
  try {
    const reporte = await InstallationReport.findById(req.params.id)
      .populate('clientId')
      .populate('zoneId')
      .populate('saleId');
    if (!reporte) throw crearError(404, 'El reporte de instalación no existe.');

    const [zonas, usuarios] = await Promise.all([
      Zone.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
      User.find({ active: true }).select('name').sort({ name: 1 }).lean(),
    ]);

    res.render('reports/installation-form', {
      titulo: `Editar instalación · ${reporte.clientName || 'cliente'}`,
      modo: 'editar',
      reporte,
      zonas,
      tecnicos: usuarios.map((u) => u.name),
      errores: [],
      erroresCampo: {},
      valores: {},
    });
  } catch (error) {
    next(error);
  }
}

/** PUT /red/reportes/instalaciones/:id */
async function actualizar(req, res, next) {
  try {
    const reporte = await InstallationReport.findById(req.params.id);
    if (!reporte) throw crearError(404, 'El reporte de instalación no existe.');
    const antes = {
      zoneId: reporte.zoneId ? String(reporte.zoneId) : null,
      technician: reporte.technician,
      installedAt: reporte.installedAt,
    };

    reporte.zoneId = mongoose.isValidObjectId(req.body.zoneId) ? req.body.zoneId : null;
    reporte.technician = String(req.body.technician || '').trim().slice(0, 80);
    reporte.technicianId = await staffService.usuarioPorNombre(reporte.technician);
    reporte.installedAt = fechaDeCampo(req.body.installedAt, reporte.installedAt);
    reporte.macAddress = normalizarMac(req.body.macAddress);
    reporte.macAuthEnabled = req.body.macAuthEnabled === 'on' || req.body.macAuthEnabled === 'true';
    if (reporte.macAuthEnabled && !reporte.macAddress) {
      throw crearError(422, 'La autenticación por MAC necesita una MAC.');
    }
    reporte.notes = String(req.body.notes || '').trim().slice(0, 500);
    await reporte.save();
    await registrar({
      module: 'technical',
      entity: 'InstallationReport',
      entityId: reporte._id,
      action: 'update',
      description: `Reporte de instalación de ${reporte.clientName || 'cliente'} actualizado (zona y técnico).`,
      changes: {
        before: antes,
        after: { zoneId: reporte.zoneId ? String(reporte.zoneId) : null, technician: reporte.technician, installedAt: reporte.installedAt },
      },
    });

    req.flash('exito', 'Reporte de instalación actualizado.');
    res.redirect(`/red/reportes/instalaciones?fecha=${fechaISO(reporte.installedAt)}`);
  } catch (error) {
    if (error.name === 'ValidationError' || error.status) {
      const reporte = await InstallationReport.findById(req.params.id)
        .populate('clientId')
        .populate('zoneId')
        .populate('saleId');
      if (!reporte) return next(error);
      const [zonas, usuarios] = await Promise.all([
        Zone.find({ active: true }).sort({ order: 1, name: 1 }).lean(),
        User.find({ active: true }).select('name').sort({ name: 1 }).lean(),
      ]);
      if (reporte) {
        reporte.zoneId = mongoose.isValidObjectId(req.body.zoneId) ? req.body.zoneId : null;
        reporte.technician = String(req.body.technician || '');
        reporte.installedAt = fechaDeCampo(req.body.installedAt, reporte.installedAt);
        reporte.macAddress = normalizarMac(req.body.macAddress);
        reporte.macAuthEnabled = req.body.macAuthEnabled === 'on' || req.body.macAuthEnabled === 'true';
        reporte.notes = String(req.body.notes || '');
      }
      const { lista, campos } = normalizarErrores(error);
      return res.status(error.status || 422).render('reports/installation-form', {
        titulo: 'Editar instalación',
        modo: 'editar',
        reporte,
        zonas,
        tecnicos: usuarios.map((u) => u.name),
        errores: lista,
        erroresCampo: campos,
        valores: req.body,
      });
    }
    next(error);
  }
}

module.exports = { index, formNuevo, crear, formEditar, actualizar };
