const AuditLog = require('../models/AuditLog');
const { resolverActores } = require('../services/auditActors');
const { crearError } = require('../utils/errors');
const { LOGS_POR_PAGINA, ETIQUETAS_MODULO, ACCIONES_AUDITORIA, MODULOS_AUDITORIA } = require('../config/constants');
const { escaparRegex } = require('../utils/strings');
const { inicioDelDia, finDelDia } = require('../utils/dates');

/** GET /logs */
async function index(req, res, next) {
  try {
    const { q = '', modulo = '', accion = '', estado = '', desde = '', hasta = '', page = 1 } = req.query;
    const consulta = {};
    if (modulo) consulta.module = modulo;
    if (accion) consulta.action = accion;
    if (estado) consulta.status = estado;
    if (desde || hasta) {
      consulta.timestamp = {};
      if (desde) consulta.timestamp.$gte = inicioDelDia(desde);
      if (hasta) consulta.timestamp.$lte = finDelDia(hasta);
    }
    if (q.trim()) {
      const regex = new RegExp(escaparRegex(q.trim()), 'i');
      consulta.$or = [{ description: regex }, { command: regex }, { entityId: regex }];
    }

    const total = await AuditLog.countDocuments(consulta);
    const paginas = Math.max(1, Math.ceil(total / LOGS_POR_PAGINA));
    const actual = Math.min(Math.max(1, Number(page) || 1), paginas);

    const logs = await AuditLog.find(consulta)
      .sort({ timestamp: -1 })
      .skip((actual - 1) * LOGS_POR_PAGINA)
      .limit(LOGS_POR_PAGINA)
      .lean();
    await resolverActores(logs);

    res.render('audit/index', {
      titulo: 'Auditoría',
      logs,
      filtros: { q, modulo, accion, estado, desde, hasta },
      paginacion: { actual, paginas, total },
      modulos: MODULOS_AUDITORIA,
      acciones: ACCIONES_AUDITORIA,
      etiquetasModulo: ETIQUETAS_MODULO,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /logs/:id */
async function show(req, res, next) {
  try {
    const log = await AuditLog.findById(req.params.id).lean();
    if (!log) throw crearError(404, 'El registro de auditoría no existe.');
    await resolverActores([log]);
    res.render('audit/show', {
      titulo: 'Detalle de auditoría',
      log,
      etiquetasModulo: ETIQUETAS_MODULO,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { index, show };
