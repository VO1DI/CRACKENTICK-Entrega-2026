const express = require('express');
const portalController = require('../controllers/portalController');

const router = express.Router();

router.get('/login', portalController.loginForm);
router.post('/login', portalController.login);
router.post('/logout', portalController.logout);
router.post('/preferencia-tema', portalController.requiereCliente, portalController.guardarTema);

router.get('/', portalController.requiereCliente, portalController.index);
router.get('/facturas', portalController.requiereCliente, portalController.facturas);
router.get('/facturas/:id', portalController.requiereCliente, portalController.facturaDetalle);
router.get('/tickets', portalController.requiereCliente, portalController.tickets);
router.get('/tickets/nuevo', portalController.requiereCliente, portalController.ticketForm);
router.post('/tickets', portalController.requiereCliente, portalController.crearTicket);
router.get('/tickets/:id', portalController.requiereCliente, portalController.ticketDetalle);
router.post('/tickets/:id/mensajes', portalController.requiereCliente, portalController.responderTicket);

module.exports = router;
