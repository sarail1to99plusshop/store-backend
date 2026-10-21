const express = require('express');
const router = express.Router();
const { handleSteadfastWebhook } = require('../controllers/courierController');

/**
 * Public Webhook Endpoints for Steadfast Courier / Packzy Callbacks
 * Steadfast sends real-time POST requests when delivery statuses change.
 */
router.post('/steadfast-webhook', handleSteadfastWebhook);
router.post('/webhook', handleSteadfastWebhook);

module.exports = router;

