const express = require('express');
const consumptionController = require('../controllers/consumptionController');

const router = express.Router();

router.get('/', consumptionController.index);

module.exports = router;
