const express = require('express');
const agendaController = require('../controllers/agendaController');
const taskTypeController = require('../controllers/taskTypeController');

const router = express.Router();

router.get('/', agendaController.index);
router.get('/nuevo', agendaController.formNuevo);
router.post('/', agendaController.crear);

/* Tipos de tarea: van antes de /:id para que "tipos" no se lea como una tarea. */
router.get('/tipos', taskTypeController.index);
router.get('/tipos/nuevo', taskTypeController.formNuevo);
router.post('/tipos', taskTypeController.crear);
router.get('/tipos/:id/editar', taskTypeController.formEditar);
router.put('/tipos/:id', taskTypeController.actualizar);
router.delete('/tipos/:id', taskTypeController.eliminar);

router.get('/:id', agendaController.ver);
router.get('/:id/editar', agendaController.formEditar);
router.put('/:id', agendaController.actualizar);
router.post('/:id/estado', agendaController.cambiarEstado);
router.delete('/:id', agendaController.eliminar);

module.exports = router;
