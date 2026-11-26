const express = require('express');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

router.get('/', notificationController.index);
router.post('/resolver-todas', notificationController.resolverTodas);
router.post('/alertas/:id/reconocer', notificationController.reconocer);
router.post('/alertas/:id/resolver', notificationController.resolver);

module.exports = router;
