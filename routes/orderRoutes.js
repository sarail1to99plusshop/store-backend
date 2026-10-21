const express = require('express');
const router = express.Router();
const {
  createOrder,
  trackOrder,
  getUserOrders,
  cancelOrder,
  createPreOrder,
  updatePaymentStatus,
} = require('../controllers/orderController');
const { handleSteadfastWebhook } = require('../controllers/courierController');

router.get('/', getUserOrders);
router.post('/', createOrder);
router.get('/track', trackOrder);
router.get('/user/:email', getUserOrders);
router.post('/steadfast-webhook', handleSteadfastWebhook);
router.patch('/:invoiceNumber/cancel', cancelOrder);
router.put('/:invoiceNumber/cancel', cancelOrder);
router.post('/:invoiceNumber/cancel', cancelOrder);
router.patch('/:invoiceNumber/payment-status', updatePaymentStatus);
router.put('/:invoiceNumber/payment-status', updatePaymentStatus);
router.post('/pre-order', createPreOrder);
router.post('/pre-orders', createPreOrder);

module.exports = router;

