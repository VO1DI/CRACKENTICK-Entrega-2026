const express = require('express');
const inventoryController = require('../controllers/inventoryController');

const router = express.Router();

router.get('/', inventoryController.index);
router.get('/nuevo', inventoryController.formNuevo);
router.post('/', inventoryController.crear);
router.post('/alertas/:id/reconocer', inventoryController.reconocerAlertaStock);
router.post('/alertas/:id/resolver', inventoryController.resolverAlertaStock);

router.get('/:id', inventoryController.show);
router.get('/:id/editar', inventoryController.formEditar);
router.put('/:id', inventoryController.actualizar);
router.post('/:id/ajustar', inventoryController.ajustar);
router.post('/:id/seriales', inventoryController.agregarSeriales);
router.post('/:id/seriales/:serialId/estado', inventoryController.cambiarSerial);
router.post('/:id/seriales/:serialId/mac', inventoryController.cambiarMacSerial);

module.exports = router;
