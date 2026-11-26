const express = require('express');
const backupController = require('../controllers/backupController');

const router = express.Router();

router.get('/', backupController.index);
router.post('/', backupController.crear);
/* La descarga va antes de /:id para no chocar con otras rutas. */
router.get('/:id/descargar', backupController.descargar);
router.post('/:id/restaurar', backupController.restaurar);
router.post('/:id/eliminar', backupController.eliminar);

module.exports = router;
