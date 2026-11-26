const express = require('express');
const poolController = require('../controllers/poolController');

const router = express.Router();

router.get('/', poolController.index);
router.get('/nuevo', poolController.formNuevo);
router.post('/', poolController.crear);
router.get('/:id/editar', poolController.formEditar);
router.put('/:id', poolController.actualizar);
router.post('/:id/aplicar', poolController.aplicar);
router.delete('/:id', poolController.eliminar);

module.exports = router;
