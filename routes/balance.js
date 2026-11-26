const express = require('express');
const balanceController = require('../controllers/balanceController');

const router = express.Router();

router.get('/', balanceController.index);
router.post('/', balanceController.guardar);
router.post('/:id/quitar', balanceController.quitar);

module.exports = router;
