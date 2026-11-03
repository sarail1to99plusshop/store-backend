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
// Note: Payment status mutations are strictly restricted to admin-protected routes (/api/admin/orders/:invoiceNumber/payment-status)
router.post('/pre-order', createPreOrder);
router.post('/pre-orders', createPreOrder);

module.exports = router;

