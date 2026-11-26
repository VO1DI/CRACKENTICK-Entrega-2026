const express = require('express');
const routerController = require('../controllers/routerController');

const router = express.Router();

router.get('/', routerController.index);
router.get('/nuevo', routerController.formNuevo);
router.post('/', routerController.crear);
router.get('/:id/editar', routerController.formEditar);
router.put('/:id', routerController.actualizar);
router.post('/:id/probar', routerController.probar);
router.post('/:id/reparar', routerController.reparar);
router.get('/:id/provisionar', routerController.formProvisionar);
router.post('/:id/provisionar', routerController.provisionarMasivo);
router.delete('/:id', routerController.eliminar);

module.exports = router;
