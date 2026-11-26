const express = require('express');
const clientController = require('../controllers/clientController');
const { requierePermiso } = require('../middlewares/auth');

const router = express.Router();

router.get('/', clientController.index);
router.get('/api/pools/:poolId/ips', clientController.apiIpsPool);
router.get('/nuevo', requierePermiso('clientes.datos'), clientController.formNuevo);
router.post('/verificar-estados', requierePermiso('finanzas.facturacion'), clientController.verificarEstados);
router.post('/', requierePermiso('clientes.datos'), clientController.crear);
router.get('/:id', clientController.show);
router.get('/:id/editar', requierePermiso('clientes.datos'), clientController.formEditar);
router.put('/:id', requierePermiso('clientes.datos'), clientController.actualizar);
router.delete('/:id', requierePermiso('clientes.datos'), clientController.eliminar);

router.get('/:id/servicio/nuevo', requierePermiso('clientes.servicio'), clientController.formServicio);
router.post('/:id/servicio', requierePermiso('clientes.servicio'), clientController.crearServicio);
router.put('/:id/servicio', requierePermiso('clientes.servicio'), clientController.actualizarServicio);
router.put('/:id/servicio/plan', requierePermiso('clientes.servicio'), clientController.cambiarPlan);
router.post('/:id/servicio/cortar', requierePermiso('clientes.cortes'), clientController.cortar);
router.post('/:id/servicio/restaurar', requierePermiso('clientes.cortes'), clientController.restaurar);
router.post('/:id/portal', requierePermiso('clientes.datos'), clientController.portal);

module.exports = router;
