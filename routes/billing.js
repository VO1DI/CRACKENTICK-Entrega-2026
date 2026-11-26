const express = require('express');
const billingController = require('../controllers/billingController');

const router = express.Router();

router.get('/', billingController.index);
router.get('/previsualizar', billingController.previsualizar);
router.post('/emitir', billingController.emitir);
router.post('/mora', billingController.mora);

module.exports = router;
