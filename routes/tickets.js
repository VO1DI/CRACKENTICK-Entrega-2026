const express = require('express');
const ticketController = require('../controllers/ticketController');

const router = express.Router();

router.get('/', ticketController.index);
router.get('/nuevo', ticketController.formNuevo);
router.post('/', ticketController.crear);
router.get('/:id', ticketController.show);
router.post('/:id/mensajes', ticketController.responder);
router.post('/:id/estado', ticketController.cambiarEstado);
router.post('/:id/prioridad', ticketController.cambiarPrioridad);

module.exports = router;
