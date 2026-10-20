const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  getAllProductsAdmin,
  createProductAdmin,
  updateProductAdmin,
  updateProductStockAdmin,
  deleteProductAdmin,
  deleteOrderAdmin,
  getAllPreOrdersAdmin,
  updatePreOrderStatusAdmin,
} = require('../controllers/adminController');

const {
  getProducts,
  getProductById,
} = require('../controllers/productController');

const {
  getCategories,
  createCategory,
  deleteCategory,
} = require('../controllers/categoryController');

const {
  getUserOrders,
  createPreOrder,
} = require('../controllers/orderController');

const { memoryStore } = require('../data/seedData');

// Helper to mock Express req and res
function mockReqRes(options = {}) {
  const req = {
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    headers: options.headers || {},
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

describe('Backend Comprehensive Integrity Suite', () => {

  describe('1. Product CRUD & ObjectId / numeric ID handling', () => {
    test('Can create a product and fallback variants are populated correctly', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          name: 'Integrity Test Product',
          price: 250,
          category: 'kitchen',
          thumbnail: 'https://example.com/test.png',
          videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        },
      });

      await createProductAdmin(req, res);
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.success, true);
      assert.ok(data.product.id);
      assert.equal(data.product.name, 'Integrity Test Product');
      assert.equal(data.product.videoUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.ok(Array.isArray(data.product.variants));
      assert.ok(data.product.variants.length > 0);
    });

    test('updateProductAdmin saves and trims updated videoUrl', async () => {
      // Create product first
      const create = mockReqRes({
        body: {
          name: 'Video Update Test Product',
          price: 199,
          category: 'kitchen',
          thumbnail: 'https://example.com/thumb.png',
        },
      });
      await createProductAdmin(create.req, create.res);
      const createdId = create.getData().product.id;

      // Update videoUrl
      const update = mockReqRes({
        params: { id: String(createdId) },
        body: {
          videoUrl: '   https://youtu.be/dQw4w9WgXcQ   ',
        },
      });
      await updateProductAdmin(update.req, update.res);
      assert.equal(update.getStatus(), 200);
      assert.equal(update.getData().product.videoUrl, 'https://youtu.be/dQw4w9WgXcQ');
    });

    test('updateProductAdmin works with non-numeric / string IDs without CastError', async () => {
      const fakeObjectId = new mongoose.Types.ObjectId().toString();
      const { req, res, getStatus, getData } = mockReqRes({
        params: { id: fakeObjectId },
        body: { price: 300 },
      });

      // Should return 404 (not found) instead of 500 CastError
      await updateProductAdmin(req, res);
      assert.equal(getStatus(), 404);
      assert.equal(getData().success, false);
    });

    test('updateProductStockAdmin works with non-numeric IDs without CastError', async () => {
      const fakeObjectId = new mongoose.Types.ObjectId().toString();
      const { req, res, getStatus } = mockReqRes({
        params: { id: fakeObjectId },
        body: { stock: 15 },
      });

      await updateProductStockAdmin(req, res);
      assert.equal(getStatus(), 404);
    });

    test('deleteProductAdmin works with non-numeric IDs without CastError', async () => {
      const fakeObjectId = new mongoose.Types.ObjectId().toString();
      const { req, res, getStatus } = mockReqRes({
        params: { id: fakeObjectId },
      });

      await deleteProductAdmin(req, res);
      assert.equal(getStatus(), 404);
    });

    test('getProducts ensures all returned products have safe variants array', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        query: { limit: 10 },
      });

      await getProducts(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      data.products.forEach((p) => {
        assert.ok(Array.isArray(p.variants), `Product #${p.id} missing variants array`);
        assert.ok(p.variants.length > 0, `Product #${p.id} has empty variants array`);
      });
    });
  });

  describe('2. Category Management & Store Synchronization', () => {
    const testCatName = `TestCat-${Date.now()}`;
    let createdCatId = '';

    test('createCategory adds category with auto-slug and syncs memory store', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: { name: testCatName },
      });

      await createCategory(req, res);
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.category.name, testCatName);
      createdCatId = data.category.id;

      // Check it is in memoryStore
      const inMem = memoryStore.categories.find((c) => c.id === createdCatId);
      assert.ok(inMem, 'Category was not synced to memoryStore');
    });

    test('createCategory rejects duplicate category with status 409', async () => {
      const { req, res, getStatus } = mockReqRes({
        body: { name: testCatName },
      });

      await createCategory(req, res);
      assert.equal(getStatus(), 409);
    });

    test('deleteCategory removes category and updates memory store', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        params: { id: createdCatId },
      });

      await deleteCategory(req, res);
      assert.equal(getStatus(), 200);
      assert.equal(getData().success, true);

      // Verify removed from memoryStore
      const inMem = memoryStore.categories.find((c) => c.id === createdCatId);
      assert.equal(inMem, undefined, 'Category was not removed from memoryStore');
    });
  });

  describe('3. Order Phone Lookups & Deletion', () => {
    test('getUserOrders supports lookup by customer phone number', async () => {
      const testPhone = '01911999888';
      memoryStore.orders.push({
        invoiceNumber: 'SAR-TEST-PHONE-01',
        totalAmount: 400,
        customerDetails: { name: 'Phone User', phone: testPhone },
        orderStatus: 'Pending',
      });

      const { req, res, getStatus, getData } = mockReqRes({
        query: { phone: testPhone },
      });

      await getUserOrders(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.ok(data.orders.some((o) => o.customerDetails?.phone === testPhone));
    });

    test('deleteOrderAdmin permanently removes order from memory and database', async () => {
      const testInv = 'SAR-TO-BE-DELETED';
      memoryStore.orders.push({
        invoiceNumber: testInv,
        totalAmount: 300,
        customerDetails: { name: 'Delete Customer', phone: '01700000000' },
        orderStatus: 'Pending',
      });

      const { req, res, getStatus, getData } = mockReqRes({
        params: { invoiceNumber: testInv },
      });

      await deleteOrderAdmin(req, res);
      assert.equal(getStatus(), 200);
      assert.equal(getData().success, true);

      // Verify it is gone
      const found = memoryStore.orders.find((o) => o.invoiceNumber === testInv);
      assert.equal(found, undefined);
    });
  });

  describe('4. Pre-Orders Management (Public & Admin)', () => {
    let createdPreOrderId = '';

    test('createPreOrder accepts valid customer pre-orders', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          productName: 'Smart Vegetable Cutter',
          customerName: 'Karim Ahmed',
          phone: '01855000000',
          email: 'karim@example.com',
          notes: 'Deliver as soon as available',
        },
      });

      await createPreOrder(req, res);
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.success, true);
      assert.ok(data.preOrder._id);
      createdPreOrderId = String(data.preOrder._id);
    });

    test('getAllPreOrdersAdmin returns all pre-orders for admin', async () => {
      const { req, res, getStatus, getData } = mockReqRes();

      await getAllPreOrdersAdmin(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.preOrders));
      assert.ok(data.preOrders.some((p) => p.customerName === 'Karim Ahmed'));
    });

    test('updatePreOrderStatusAdmin updates pre-order status', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        params: { id: createdPreOrderId },
        body: { status: 'Contacted' },
      });

      await updatePreOrderStatusAdmin(req, res);
      assert.equal(getStatus(), 200);
      assert.equal(getData().success, true);
      assert.equal(getData().preOrder.status, 'Contacted');
    });
  });
});

