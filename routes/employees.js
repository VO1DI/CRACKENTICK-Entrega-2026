const express = require('express');
const employeeController = require('../controllers/employeeController');
const statsController = require('../controllers/statsController');

const router = express.Router();

router.get('/', employeeController.index);
router.get('/rendimiento', statsController.index);
router.get('/nuevo', employeeController.formNuevo);
router.post('/', employeeController.crear);
router.get('/:id/editar', employeeController.formEditar);
router.put('/:id', employeeController.actualizar);
router.post('/:id/pagar', employeeController.pagar);
router.delete('/:id', employeeController.eliminar);

module.exports = router;
