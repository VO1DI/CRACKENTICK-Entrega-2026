const express = require('express');
const userController = require('../controllers/userController');
const presetController = require('../controllers/presetController');

const router = express.Router();

router.get('/', userController.index);
router.get('/nuevo', userController.formNuevo);
router.post('/', userController.crear);

/* Presets de permisos: plantillas, nunca tocan usuarios existentes. */
router.get('/presets', presetController.index);
router.get('/presets/nuevo', presetController.formNuevo);
router.post('/presets', presetController.crear);
router.get('/presets/:id/editar', presetController.formEditar);
router.put('/presets/:id', presetController.actualizar);
router.delete('/presets/:id', presetController.eliminar);

router.get('/:id/editar', userController.formEditar);
router.put('/:id', userController.actualizar);
router.post('/:id/estado', userController.cambiarEstado);
router.delete('/:id', userController.eliminar);

module.exports = router;
