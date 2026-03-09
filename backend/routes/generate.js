const express = require('express');
const router = express.Router();
const generateController = require('../controllers/generateController');
const { generateLimiter } = require('../middleware/rateLimiter');

router.post('/adegan', generateLimiter, generateController.adegan);
router.post('/adegan/v1', generateLimiter, generateController.adegan);
router.post('/adegan/v2', generateLimiter, generateController.adegan);

router.post('/ghibah', generateLimiter, generateController.ghibah);
router.post('/ghibah/v1', generateLimiter, generateController.ghibah);
router.post('/ghibah/v2', generateLimiter, generateController.ghibah);

router.post('/voice', generateLimiter, generateController.voice);
router.post('/lukisan', generateLimiter, generateController.lukisan);
router.get('/status/:id', generateController.status);
router.get('/image-proxy', generateController.imageProxy);
router.post('/merge', generateController.merge);
router.post('/cleanup', generateController.cleanupVideo);

// Legacy routes (keep for backward compat)
router.post('/alive', generateLimiter, generateController.adegan);
router.post('/canvas', generateLimiter, generateController.adegan);
router.post('/transition', generateLimiter, generateController.adegan);

module.exports = router;
