const express = require('express');
const invoiceController = require('../controllers/invoiceController');

const router = express.Router();

router.get('/', invoiceController.index);
router.get('/nueva', invoiceController.formNuevo);
router.post('/', invoiceController.crear);
router.get('/:id/editar', invoiceController.formEditar);
router.put('/:id', invoiceController.actualizar);
router.get('/:id', invoiceController.show);
router.post('/:id/pagar', invoiceController.pagar);
router.post('/:id/anular', invoiceController.anular);

module.exports = router;
