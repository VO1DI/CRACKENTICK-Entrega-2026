const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

router.get('/login', authController.mostrar);
router.post('/login', authController.entrar);
router.post('/salir', authController.salir);

module.exports = router;
