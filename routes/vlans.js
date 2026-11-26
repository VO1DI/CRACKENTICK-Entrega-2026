const express = require('express');
const vlanController = require('../controllers/vlanController');

const router = express.Router();

router.get('/', vlanController.index);
router.get('/nuevo', vlanController.formNuevo);
router.post('/', vlanController.crear);
router.get('/:id/editar', vlanController.formEditar);
router.put('/:id', vlanController.actualizar);
router.post('/:id/estado', vlanController.cambiarEstado);
router.delete('/:id', vlanController.eliminar);

module.exports = router;
