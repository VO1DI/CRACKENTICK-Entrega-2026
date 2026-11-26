const Settings = require('../models/Settings');
const assistantService = require('../services/assistantService');
const { registrar } = require('../services/auditService');

/** GET /asistente/estado */
async function estado(req, res, next) {
  try {
    const settings = await Settings.getSingleton();
    res.json({
      ok: true,
      habilitado: Boolean(settings.ai?.enabled),
      modelo: settings.ai?.model || '',
      usuario: req.usuario?.name || '',
    });
  } catch (error) {
    next(error);
  }
}

/** POST /asistente/mensaje */
async function mensaje(req, res, next) {
  try {
    const settings = await Settings.findOne({ key: 'system' }).select('+ai.apiKeyEnc +ai.braveApiKeyEnc');
    const texto = String(req.body.mensaje || '').trim();
    if (!texto) return res.status(422).json({ error: 'Escribe una pregunta.' });

    const respuesta = await assistantService.responder({
      usuario: req.usuario,
      settings,
      historial: req.body.historial,
      mensaje: texto,
    });

    req.session.asistentePendiente = respuesta.pendiente
      ? { ...respuesta.pendiente, modelo: respuesta.modelo }
      : null;

    await registrar({
      module: 'support',
      entity: 'Assistant',
      entityId: req.usuario?._id,
      action: 'assistant',
      description: `Asistente IA (${req.usuario?.username || 'usuario'}): ${texto.slice(0, 100)}`,
      aiModel: respuesta.modelo,
      aiAssisted: true,
      confirmed: true,
      confirmedBy: req.usuario?.username || 'usuario',
    });

    res.json({
      ok: true,
      mensaje: respuesta.mensaje,
      modelo: respuesta.modelo,
      pendiente: respuesta.pendiente ? { resumen: respuesta.pendiente.resumen } : null,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('⚠️  Asistente IA:', error.message);
    res.status(502).json({ error: 'No se pudo completar la consulta con el proveedor de IA.' });
  }
}

/** POST /asistente/confirmar */
async function confirmar(req, res, next) {
  try {
    const pendiente = req.session.asistentePendiente;
    if (!pendiente) return res.status(422).json({ error: 'No hay una acción pendiente.' });
    const resultado = await assistantService.aplicarPendiente(pendiente, req.usuario);
    req.session.asistentePendiente = null;
    res.json({ ok: true, ...resultado });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('⚠️  Asistente IA (confirmar):', error.message);
    res.status(500).json({ error: 'No se pudo aplicar la acción pendiente.' });
  }
}

/** POST /asistente/cancelar */
function cancelar(req, res) {
  req.session.asistentePendiente = null;
  res.json({ ok: true });
}

module.exports = { estado, mensaje, confirmar, cancelar };
