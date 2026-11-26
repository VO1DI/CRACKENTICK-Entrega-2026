const express = require('express');
const dhcpServerController = require('../controllers/dhcpServerController');

const router = express.Router();

router.get('/', dhcpServerController.index);
router.post('/', dhcpServerController.crear);

module.exports = router;
