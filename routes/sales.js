const express = require('express');
const salesController = require('../controllers/salesController');
const clientController = require('../controllers/clientController');
const { requierePermiso } = require('../middlewares/auth');

const router = express.Router();

/* El formulario de venta necesita las IPs del pool aunque el usuario no tenga nodos de clientes. */
router.get('/api/pools/:poolId/ips', clientController.apiIpsPool);
router.get('/', salesController.index);
router.get('/nueva', requierePermiso('ventas.ventas'), salesController.formNuevo);
router.post('/', requierePermiso('ventas.ventas'), salesController.crear);
router.get('/:id', salesController.show);
router.get('/:id/servicio/editar', requierePermiso('ventas.instalar'), salesController.formServicio);
router.post('/:id/servicio/editar', requierePermiso('ventas.instalar'), salesController.actualizarServicio);
router.get('/:id/materiales/editar', requierePermiso('ventas.inventario'), salesController.formMateriales);
router.post('/:id/materiales/editar', requierePermiso('ventas.inventario'), salesController.actualizarMateriales);
router.post('/:id/instalar', requierePermiso('ventas.instalar'), salesController.instalar);
router.post('/:id/cancelar', requierePermiso('ventas.ventas'), salesController.cancelar);

module.exports = router;
