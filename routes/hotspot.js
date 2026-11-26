const express = require('express');
const hotspotController = require('../controllers/hotspotController');

const router = express.Router();

router.get('/', hotspotController.index);
router.get('/planes', hotspotController.planes);
router.post('/planes', hotspotController.crearPlan);
router.post('/planes/:id/estado', hotspotController.estadoPlan);
router.post('/planes/:id/eliminar', hotspotController.eliminarPlan);
router.post('/config/:id', hotspotController.guardarConfig);
router.post('/lotes', hotspotController.crearLote);
router.get('/lote/:id/imprimir', hotspotController.imprimirLote);
router.post('/:id/vender', hotspotController.vender);
router.post('/:id/revocar', hotspotController.revocar);

module.exports = router;
