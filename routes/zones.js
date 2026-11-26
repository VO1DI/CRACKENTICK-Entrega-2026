const express = require('express');
const zoneController = require('../controllers/zoneController');

const router = express.Router();

router.get('/', zoneController.index);
router.get('/:id/editar', zoneController.formEditar);
router.post('/', zoneController.crear);
router.put('/:id', zoneController.actualizar);
router.delete('/:id', zoneController.eliminar);

module.exports = router;
