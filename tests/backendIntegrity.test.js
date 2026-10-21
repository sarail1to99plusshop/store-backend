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
  sendOrderInvoiceEmailAdmin,
} = require('../controllers/adminController');
const {
  buildOrderEmailContent,
  sendOrderInvoiceEmail,
  sendOrderCancelledEmail,
} = require('../services/emailService');

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
  createOrder,
  createPreOrder,
  cancelOrder,
} = require('../controllers/orderController');

const {
  getDeliveryCharges,
  getAllDeliveryChargesAdmin,
  createDeliveryChargeAdmin,
  updateDeliveryChargeAdmin,
  deleteDeliveryChargeAdmin,
} = require('../controllers/deliveryController');

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

  describe('5. Email Notification System & Invoice Templates', () => {
    const sampleOrder = {
      invoiceNumber: 'SAR-TEST-EMAIL-001',
      customerDetails: {
        name: 'Fatima Begum',
        email: 'fatima@example.com',
        phone: '01711000000',
        address: 'House 12, Road 5, Dhanmondi, Dhaka',
        deliveryLocation: 'Inside Dhaka',
      },
      items: [
        {
          title: '360 Kitchen Tap Water Filter',
          color: 'Blue',
          quantity: 2,
          price: 150,
          subtotal: 300,
        },
      ],
      itemsSubtotal: 300,
      deliveryFee: 60,
      totalAmount: 360,
      paymentMethod: 'COD',
      paymentStatus: 'Pending',
      courierData: {
        trackingCode: 'SF99887766',
        trackingUrl: 'https://steadfast.com.bd/t/SF99887766',
      },
    };

    test('buildOrderEmailContent generates professional Shipped email with invoice & courier details', () => {
      const { subject, html, text } = buildOrderEmailContent(sampleOrder, 'Shipped');
      assert.ok(subject.includes('Shipped'));
      assert.ok(subject.includes('SAR-TEST-EMAIL-001'));
      assert.ok(html.includes('Fatima Begum'));
      assert.ok(html.includes('360 Kitchen Tap Water Filter'));
      assert.ok(html.includes('SF99887766'));
      assert.ok(html.includes('৳360'));
      assert.ok(text.includes('SF99887766'));
    });

    test('buildOrderEmailContent generates professional Delivered email with receipt details', () => {
      const { subject, html, text } = buildOrderEmailContent(sampleOrder, 'Delivered');
      assert.ok(subject.includes('Delivered'));
      assert.ok(subject.includes('SAR-TEST-EMAIL-001'));
      assert.ok(html.includes('Fatima Begum'));
      assert.ok(html.includes('Total Payable'));
      assert.ok(text.includes('Delivered'));
    });

    test('buildOrderEmailContent generates professional Cancelled email with cancellation notice', () => {
      const { subject, html, text } = buildOrderEmailContent(sampleOrder, 'Cancelled');
      assert.ok(subject.includes('Cancelled'));
      assert.ok(subject.includes('SAR-TEST-EMAIL-001'));
      assert.ok(html.includes('Fatima Begum'));
      assert.ok(html.includes('Cancelled'));
      assert.ok(html.includes('বাতিল'));
      assert.ok(text.includes('Cancelled'));
      assert.ok(text.includes('refund'));
    });

    test('cancelOrder updates orderStatus to Cancelled and triggers cancelled email handler safely', async () => {
      // Add an order to memoryStore to cancel
      memoryStore.orders.push({
        invoiceNumber: 'SAR-TEST-CANCEL-MAIL',
        orderStatus: 'Pending',
        customerDetails: {
          name: 'Habib Rahman',
          email: 'habib@example.com',
          phone: '01912345678',
          address: 'Sylhet',
        },
        items: [{ productId: 1, quantity: 1, price: 150 }],
      });

      const { req, res, getStatus, getData } = mockReqRes({
        params: { invoiceNumber: 'SAR-TEST-CANCEL-MAIL' },
      });

      await cancelOrder(req, res);
      assert.equal(getStatus(), 200);
      assert.equal(getData().success, true);
      assert.equal(getData().order.orderStatus, 'Cancelled');
    });

    test('sendOrderInvoiceEmail skips gracefully when order has no customer email', async () => {
      const orderWithoutEmail = {
        invoiceNumber: 'SAR-NO-EMAIL',
        customerDetails: { name: 'Customer No Email', phone: '01700000000' },
      };
      const result = await sendOrderInvoiceEmail(orderWithoutEmail, 'Shipped');
      assert.equal(result.success, false);
      assert.equal(result.skipped, true);
    });

    test('sendOrderInvoiceEmailAdmin rejects order when no customer email exists', async () => {
      // Push temporary order without email to memoryStore
      memoryStore.orders.push({
        invoiceNumber: 'SAR-TEST-NO-EMAIL-INV',
        customerDetails: { name: 'No Email User', phone: '01800000000' },
        items: [],
      });

      const { req, res, getStatus, getData } = mockReqRes({
        params: { invoiceNumber: 'SAR-TEST-NO-EMAIL-INV' },
      });

      await sendOrderInvoiceEmailAdmin(req, res);
      assert.equal(getStatus(), 400);
      assert.equal(getData().success, false);
      assert.ok(getData().message.includes('valid customer email'));
    });

    test('sendOrderInvoiceEmailAdmin returns 404 for nonexistent order', async () => {
      const { req, res, getStatus } = mockReqRes({
        params: { invoiceNumber: 'SAR-DOES-NOT-EXIST-999' },
      });

      await sendOrderInvoiceEmailAdmin(req, res);
      assert.equal(getStatus(), 404);
    });
  });

  describe('6. Delivery Location Management & Detailed Address Enforcement', () => {
    test('getDeliveryCharges returns active delivery charges array', async () => {
      const { req, res, getStatus, getData } = mockReqRes();
      await getDeliveryCharges(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.deliveryCharges));
      assert.ok(data.deliveryCharges.length >= 2);
      assert.ok(data.deliveryCharges.some((c) => c.location.toLowerCase().includes('dhaka')));
    });

    test('getAllDeliveryChargesAdmin returns full admin list of delivery charges', async () => {
      const { req, res, getStatus, getData } = mockReqRes();
      await getAllDeliveryChargesAdmin(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.deliveryCharges));
      assert.ok(data.deliveryCharges.length >= 2);
    });

    test('createDeliveryChargeAdmin adds new delivery zone and updates store', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          location: 'Dhaka Sub-Urban (Savar, Gazipur, Keraniganj)',
          charge: 90,
          estimatedDays: '1-3 days',
          isDefault: false,
          isActive: true,
        },
      });

      await createDeliveryChargeAdmin(req, res);
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.deliveryCharge.charge, 90);
      assert.ok(data.deliveryCharge.id);

      // Verify presence in memoryStore
      const found = memoryStore.deliveryCharges.find((c) => c.id === data.deliveryCharge.id);
      assert.ok(found);
      assert.equal(found.charge, 90);
    });

    test('updateDeliveryChargeAdmin modifies charge amount and active status', async () => {
      const targetZone = memoryStore.deliveryCharges[0];
      const initialCharge = targetZone.charge;

      const { req, res, getStatus, getData } = mockReqRes({
        params: { id: targetZone.id },
        body: {
          charge: 65,
          estimatedDays: '1-2 business days',
        },
      });

      await updateDeliveryChargeAdmin(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.deliveryCharge.charge, 65);

      // Restore to original charge to prevent side-effects
      targetZone.charge = initialCharge;
    });

    test('deleteDeliveryChargeAdmin removes custom delivery zone', async () => {
      // Add a temporary zone
      const tempId = `temp-zone-${Date.now()}`;
      memoryStore.deliveryCharges.push({
        id: tempId,
        location: 'Temporary Delivery Zone',
        charge: 100,
        estimatedDays: '3 days',
        isDefault: false,
        isActive: true,
      });

      const { req, res, getStatus } = mockReqRes({
        params: { id: tempId },
      });

      await deleteDeliveryChargeAdmin(req, res);
      assert.equal(getStatus(), 200);
      const exists = memoryStore.deliveryCharges.some((c) => c.id === tempId);
      assert.equal(exists, false);
    });

    test('createOrder rejects missing or empty customer address with 400', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          customerDetails: {
            name: 'Habib Rahman',
            phone: '01711111111',
            address: '',
            deliveryLocation: 'Inside Dhaka',
          },
          items: [{ productId: 1, quantity: 1, price: 150 }],
          paymentMethod: 'Cash on Delivery',
        },
      });

      await createOrder(req, res);
      assert.equal(getStatus(), 400);
      assert.match(getData().message, /strictly required/i);
    });

    test('createOrder rejects vague hub-only address (e.g. "Gazipur, sadar", "Dhaka, Narsingdi, Raipura") with 400', async () => {
      const vagueAddresses = [
        'Gazipur, sadar',
        'Dhaka',
        'Chittagong',
        'Sadar, Sylhet',
        'Mirpur',
        'Dhaka, Narsingdi, Raipura',
      ];

      for (const addr of vagueAddresses) {
        const { req, res, getStatus, getData } = mockReqRes({
          body: {
            customerDetails: {
              name: 'Customer Test',
              phone: '01711111111',
              address: addr,
              deliveryLocation: 'Inside Dhaka',
            },
            items: [{ productId: 1, quantity: 1, price: 150 }],
            paymentMethod: 'Cash on Delivery',
          },
        });

        await createOrder(req, res);
        assert.equal(getStatus(), 400, `Expected address "${addr}" to be rejected`);
        assert.match(getData().message, /complete and detailed delivery address/i);
      }
    });

    test('createOrder rejects invalid Bangladeshi phone numbers with 400', async () => {
      const invalidPhones = ['01211111111', '017123', '02712345678', 'abcdefghijk'];
      for (const phone of invalidPhones) {
        const { req, res, getStatus, getData } = mockReqRes({
          body: {
            customerDetails: {
              name: 'Customer Phone Test',
              phone,
              address: 'House 14, Road 5, Block B, Mirpur 10, Dhaka',
              deliveryLocation: 'Inside Dhaka',
            },
            items: [{ productId: 1, quantity: 1, price: 150 }],
            paymentMethod: 'Cash on Delivery',
          },
        });

        await createOrder(req, res);
        assert.equal(getStatus(), 400, `Expected phone "${phone}" to be rejected`);
        assert.match(getData().message, /11-digit Bangladeshi mobile number/i);
      }
    });

    test('createOrder rejects address shorter than 15 characters with 400', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          customerDetails: {
            name: 'Short Address User',
            phone: '01711111111',
            address: 'House 1, Rd 2', // 13 characters (< 15)
            deliveryLocation: 'Inside Dhaka',
          },
          items: [{ productId: 1, quantity: 1, price: 150 }],
          paymentMethod: 'Cash on Delivery',
        },
      });

      await createOrder(req, res);
      assert.equal(getStatus(), 400);
      assert.match(getData().message, /at least 15 characters/i);
    });

    test('createOrder accepts detailed street/area address for order placement', async () => {
      const detailedAddress = 'House 14, Road 5, Block B, Mirpur 10, Dhaka';
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          customerDetails: {
            name: 'Tahmid Hasan',
            phone: '01722222222',
            address: detailedAddress,
            deliveryLocation: 'Inside Dhaka',
          },
          items: [{ productId: 1, quantity: 1, price: 150 }],
          paymentMethod: 'Cash on Delivery',
        },
      });

      await createOrder(req, res);
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.order.customerDetails.address, detailedAddress);
    });

    test('Order schema and createOrder accept custom delivery locations (e.g. "Outside brahmanbaria")', async () => {
      const Order = require('../models/Order');
      
      // 1. Verify Mongoose model validation does not fail with custom deliveryLocation
      const doc = new Order({
        invoiceNumber: `SAR-TEST-ZONE-${Date.now()}`,
        customerDetails: {
          name: 'Brahmanbaria Customer',
          phone: '01733333333',
          address: 'College Road, Sarail Sadar, Brahmanbaria',
          deliveryLocation: 'Outside brahmanbaria',
        },
        items: [{
          title: 'Test Product',
          price: 200,
          quantity: 1,
          subtotal: 200,
        }],
        itemsSubtotal: 200,
        deliveryFee: 120,
        totalAmount: 320,
      });

      const validationError = doc.validateSync();
      assert.equal(validationError, undefined, 'Mongoose validation should succeed for custom deliveryLocation');

      // 2. Verify createOrder endpoint processes custom deliveryLocation cleanly
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          customerDetails: {
            name: 'Brahmanbaria Customer',
            phone: '01733333333',
            address: 'College Road, Sarail Sadar, Brahmanbaria',
            deliveryLocation: 'Outside brahmanbaria',
          },
          items: [{ productId: 1, quantity: 1, price: 150 }],
          deliveryFee: 120,
          paymentMethod: 'Cash on Delivery',
        },
      });

      await createOrder(req, res);
      assert.equal(getStatus(), 201);
      assert.equal(getData().success, true);
      assert.equal(getData().order.customerDetails.deliveryLocation, 'Outside brahmanbaria');
    });
  });
});

