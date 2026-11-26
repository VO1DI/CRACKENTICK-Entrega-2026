const express = require('express');
const ipamController = require('../controllers/ipamController');

const router = express.Router();

router.get('/', ipamController.index);
router.get('/:id', ipamController.detalle);

module.exports = router;
