const express = require('express');
const router = express.Router();
const {
  adminLogin,
  getSystemStatus,
  getAllProductsAdmin,
  createProductAdmin,
  updateProductAdmin,
  updateProductStockAdmin,
  deleteProductAdmin,
  getAllOrdersAdmin,
  shipOrderWithSteadfast,
  updateOrderStatusAdmin,
  updatePaymentStatusAdmin,
  getDeliveredMonthlyReport,
  pollRecentOrders,
  markOrderViewedAdmin,
  markAllOrdersViewedAdmin,
  getAllUsersAdmin,
  getUserOrdersAdmin,
} = require('../controllers/adminController');
const { verifyAdmin } = require('../middleware/authMiddleware');

// Public route: Admin login
router.post('/login', adminLogin);

// Protected routes (require valid admin token)
router.use(verifyAdmin);

// System Status (Active / Disconnect MongoDB check)
router.get('/system-status', getSystemStatus);

// Product Management (CRUD & Stock control)
router.get('/products', getAllProductsAdmin);
router.post('/products', createProductAdmin);
router.put('/products/:id', updateProductAdmin);
router.patch('/products/:id/stock', updateProductStockAdmin);
router.delete('/products/:id', deleteProductAdmin);

// Order Management & Steadfast Courier Integration
router.get('/orders', getAllOrdersAdmin);
router.get('/orders/poll', pollRecentOrders);
router.patch('/orders/mark-all-viewed', markAllOrdersViewedAdmin);
router.patch('/orders/:invoiceNumber/view', markOrderViewedAdmin);
router.post('/orders/:invoiceNumber/ship-steadfast', shipOrderWithSteadfast);
router.patch('/orders/:invoiceNumber/status', updateOrderStatusAdmin);
router.patch('/orders/:invoiceNumber/payment-status', updatePaymentStatusAdmin);

// User & Customer Management & User Orders
router.get('/users', getAllUsersAdmin);
router.get('/users/:identifier/orders', getUserOrdersAdmin);

// Monthly Delivered Product Reports
router.get('/reports/monthly', getDeliveredMonthlyReport);

module.exports = router;

