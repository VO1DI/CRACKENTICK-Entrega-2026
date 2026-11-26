const express = require('express');
const settingsController = require('../controllers/settingsController');

const router = express.Router();

router.get('/', settingsController.index);
router.put('/empresa', settingsController.actualizarEmpresa);
router.put('/facturacion', settingsController.actualizarFacturacion);
router.put('/firewall', settingsController.actualizarFirewall);
router.post('/firewall/probar', settingsController.probar);
router.put('/ia', settingsController.actualizarIA);
router.post('/ia/modelos', settingsController.listarModelosIA);
router.put('/notificaciones', settingsController.actualizarNotificaciones);
router.put('/respaldos', settingsController.guardarRespaldos);
router.post('/respaldos/sistema', settingsController.crearRespaldoSistema);
router.get('/respaldos/sistema/estado', settingsController.estadoRespaldo);
router.post('/respaldos/sistema/probar', settingsController.probarRespaldo);
router.post('/notificaciones/probar', settingsController.probarNotificaciones);
router.get('/firewall/simulador', settingsController.simulador);
router.post('/firewall/simular', settingsController.simular);
router.get('/provision/simulador', settingsController.simuladorAprovisionamiento);
router.post('/provision/simular', settingsController.simularAprovisionamiento);

module.exports = router;
