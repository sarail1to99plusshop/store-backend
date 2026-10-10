const express = require('express');
const router = express.Router();
const {
  createOrder,
  trackOrder,
  getUserOrders,
  createPreOrder,
} = require('../controllers/orderController');

router.post('/', createOrder);
router.get('/track', trackOrder);
router.get('/user/:email', getUserOrders);
router.post('/pre-order', createPreOrder);

module.exports = router;

