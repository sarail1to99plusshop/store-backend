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
  deleteOrderAdmin,
  getDeliveredMonthlyReport,
  pollRecentOrders,
  markOrderViewedAdmin,
  markAllOrdersViewedAdmin,
  getAllUsersAdmin,
  getUserOrdersAdmin,
  getAllPreOrdersAdmin,
  updatePreOrderStatusAdmin,
  sendOrderInvoiceEmailAdmin,
  testEmailConfigAdmin,
  getSteadfastBalanceAdmin,
  checkCourierStatusAdmin,
} = require('../controllers/adminController');
const {
  getCategories,
  createCategory,
  deleteCategory,
} = require('../controllers/categoryController');
const {
  getAllDeliveryChargesAdmin,
  createDeliveryChargeAdmin,
  updateDeliveryChargeAdmin,
  deleteDeliveryChargeAdmin,
} = require('../controllers/deliveryController');
const { verifyAdmin } = require('../middleware/authMiddleware');

// Public route: Admin login
router.post('/login', adminLogin);

// Protected routes (require valid admin token)
router.use(verifyAdmin);

// Category Management in MongoDB Collection
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.delete('/categories/:id', deleteCategory);

// Delivery Locations & Charges Management (Inside Dhaka, Outside Dhaka & custom zones)
router.get('/delivery-charges', getAllDeliveryChargesAdmin);
router.post('/delivery-charges', createDeliveryChargeAdmin);
router.put('/delivery-charges/:id', updateDeliveryChargeAdmin);
router.patch('/delivery-charges/:id', updateDeliveryChargeAdmin);
router.delete('/delivery-charges/:id', deleteDeliveryChargeAdmin);

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
router.get('/orders/:invoiceNumber/courier-status', checkCourierStatusAdmin);
router.get('/courier/balance', getSteadfastBalanceAdmin);
router.patch('/orders/:invoiceNumber/status', updateOrderStatusAdmin);
router.patch('/orders/:invoiceNumber/payment-status', updatePaymentStatusAdmin);
router.post('/orders/:invoiceNumber/send-email', sendOrderInvoiceEmailAdmin);
router.get('/test-email', testEmailConfigAdmin);
router.delete('/orders/:invoiceNumber', deleteOrderAdmin);

// User & Customer Management & User Orders
router.get('/users', getAllUsersAdmin);
router.get('/users/:identifier/orders', getUserOrdersAdmin);

// Pre-Orders Management (Admin)
router.get('/pre-orders', getAllPreOrdersAdmin);
router.patch('/pre-orders/:id', updatePreOrderStatusAdmin);

// Monthly Delivered Product Reports
router.get('/reports/monthly', getDeliveredMonthlyReport);

module.exports = router;

