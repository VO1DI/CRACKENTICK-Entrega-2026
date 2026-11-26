const express = require('express');
const assistantController = require('../controllers/assistantController');

const router = express.Router();

router.get('/estado', assistantController.estado);
router.post('/mensaje', assistantController.mensaje);
router.post('/confirmar', assistantController.confirmar);
router.post('/cancelar', assistantController.cancelar);

module.exports = router;
