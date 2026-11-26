const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const { requierePermiso } = require('../middlewares/auth');

const router = express.Router();

router.get('/', requierePermiso('general.dashboard'), dashboardController.index);
router.get('/dashboard', requierePermiso('general.dashboard'), (req, res) => res.redirect('/'));

module.exports = router;
