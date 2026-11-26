const express = require('express');
const faultReportController = require('../controllers/faultReportController');

const router = express.Router();

router.get('/', faultReportController.index);
router.get('/nuevo', faultReportController.formNuevo);
router.post('/', faultReportController.crear);
router.get('/:id/editar', faultReportController.formEditar);
router.put('/:id', faultReportController.actualizar);
router.post('/:id/estado', faultReportController.cambiarEstado);
router.delete('/:id', faultReportController.eliminar);

module.exports = router;
