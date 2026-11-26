const express = require('express');
const installationReportController = require('../controllers/installationReportController');

const router = express.Router();

router.get('/', installationReportController.index);
router.get('/nueva', installationReportController.formNuevo);
router.post('/', installationReportController.crear);
router.get('/:id/editar', installationReportController.formEditar);
router.put('/:id', installationReportController.actualizar);

module.exports = router;
