const express = require('express');
const monitoringController = require('../controllers/monitoringController');

const router = express.Router();

router.get('/', monitoringController.index);
router.get('/configuracion', monitoringController.formConfiguracion);
router.post('/configuracion', monitoringController.guardarConfiguracion);
router.get('/api/wan', monitoringController.apiWan);
router.get('/cliente', (req, res) => {
  const valor = String(req.query.id || '');
  const id = valor.split('/').filter(Boolean).pop() || '';
  return res.redirect(id ? `/red/monitoreo/cliente/${encodeURIComponent(id)}` : '/red/monitoreo');
});
router.get('/cliente/:id', monitoringController.cliente);
router.post('/api/cliente/:id/iniciar', monitoringController.iniciarCliente);
router.get('/api/cliente/:id/leer', monitoringController.leerCliente);
router.post('/api/cliente/:id/detener', monitoringController.detenerCliente);
router.post('/interfaces', monitoringController.crearInterfaz);
router.post('/alertas/:id/reconocer', monitoringController.reconocerAlerta);
router.post('/alertas/:id/resolver', monitoringController.resolverAlerta);

module.exports = router;
