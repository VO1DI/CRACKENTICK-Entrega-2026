const express = require('express');
const planController = require('../controllers/planController');

const router = express.Router();

router.get('/', planController.index);
router.get('/nuevo', planController.formNuevo);
router.post('/', planController.crear);
router.get('/:id/editar', planController.formEditar);
router.put('/:id', planController.actualizar);
router.post('/:id/estado', planController.alternarEstado);
router.delete('/:id', planController.eliminar);

module.exports = router;
