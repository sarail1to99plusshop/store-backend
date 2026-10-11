const express = require('express');
const router = express.Router();
const {
  createOrder,
  trackOrder,
  getUserOrders,
  cancelOrder,
  createPreOrder,
} = require('../controllers/orderController');

router.get('/', getUserOrders);
router.post('/', createOrder);
router.get('/track', trackOrder);
router.get('/user/:email', getUserOrders);
router.patch('/:invoiceNumber/cancel', cancelOrder);
router.put('/:invoiceNumber/cancel', cancelOrder);
router.post('/:invoiceNumber/cancel', cancelOrder);
router.post('/pre-order', createPreOrder);

module.exports = router;

