const express = require('express');
const auditController = require('../controllers/auditController');

const router = express.Router();

router.get('/', auditController.index);
router.get('/:id', auditController.show);

module.exports = router;
