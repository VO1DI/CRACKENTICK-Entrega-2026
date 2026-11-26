const express = require('express');
const experimentalController = require('../controllers/experimentalController');

const router = express.Router();

router.get('/', experimentalController.index);

module.exports = router;
