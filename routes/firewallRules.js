const express = require('express');
const firewallRuleController = require('../controllers/firewallRuleController');

const router = express.Router();

router.get('/', firewallRuleController.index);
router.get('/nuevo', firewallRuleController.formNuevo);
router.post('/', firewallRuleController.crear);
router.get('/:id/editar', firewallRuleController.formEditar);
router.put('/:id', firewallRuleController.actualizar);
router.post('/:id/estado', firewallRuleController.cambiarEstado);
router.delete('/:id', firewallRuleController.eliminar);

module.exports = router;
