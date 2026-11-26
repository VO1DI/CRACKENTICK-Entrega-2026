const express = require('express');
const eoipController = require('../controllers/eoipController');

const router = express.Router();

router.get('/', eoipController.index);
router.get('/nuevo', eoipController.formNuevo);
router.post('/', eoipController.crear);
router.get('/:id/editar', eoipController.formEditar);
router.put('/:id', eoipController.actualizar);
router.post('/:id/estado', eoipController.cambiarEstado);
router.delete('/:id', eoipController.eliminar);

module.exports = router;
