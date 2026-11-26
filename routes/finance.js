const express = require('express');
const financeController = require('../controllers/financeController');

const router = express.Router();

router.get('/', financeController.index);
router.get('/mes', financeController.index);

module.exports = router;
