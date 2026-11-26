const express = require('express');
const expenseController = require('../controllers/expenseController');

const router = express.Router();

router.get('/', expenseController.index);
router.get('/nuevo', expenseController.formNuevo);
router.post('/', expenseController.crear);
router.get('/:id/editar', expenseController.formEditar);
router.put('/:id', expenseController.actualizar);
router.post('/:id/estado', expenseController.cambiarEstado);
router.delete('/:id', expenseController.eliminar);

module.exports = router;
