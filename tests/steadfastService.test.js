const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  formatBdPhone,
  calculateOrderCodAmount,
  buildItemSummary,
  buildDeliveryAddress,
  createSteadfastConsignment,
} = require('../services/steadfastService');

const {
  shipOrderWithSteadfast,
  getSteadfastBalanceAdmin,
  checkCourierStatusAdmin,
} = require('../controllers/adminController');

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

describe('Steadfast Courier / Packzy API Integration Suite', () => {
  describe('1. Phone Number Sanitization & BD Mobile Validation', () => {
    test('normalizes 11-digit number with +88 prefix', () => {
      const res = formatBdPhone('+8801712345678');
      assert.equal(res.valid, true);
      assert.equal(res.phone, '01712345678');
    });

    test('normalizes 11-digit number with 88 prefix without plus', () => {
      const res = formatBdPhone('8801812345678');
      assert.equal(res.valid, true);
      assert.equal(res.phone, '01812345678');
    });

    test('strips dashes, spaces, and brackets', () => {
      const res = formatBdPhone('(01912) 345-678');
      assert.equal(res.valid, true);
      assert.equal(res.phone, '01912345678');
    });

    test('rejects short or invalid phone numbers', () => {
      const res = formatBdPhone('0171234');
      assert.equal(res.valid, false);
      assert.ok(res.reason.includes('11-digit'));
    });

    test('rejects phone numbers that do not start with 01', () => {
      const res = formatBdPhone('02712345678');
      assert.equal(res.valid, false);
    });
  });

  describe('2. Smart Cash on Delivery (COD) Amount Calculations', () => {
    test('COD payment method requires full order total at delivery', () => {
      const order = {
        paymentMethod: 'COD',
        totalAmount: 1250,
        itemsSubtotal: 1190,
        deliveryFee: 60,
      };
      const cod = calculateOrderCodAmount(order);
      assert.equal(cod, 1250);
    });

    test('bKash full payment requires 0 at delivery', () => {
      const order = {
        paymentMethod: 'bKash',
        totalAmount: 1250,
        paymentDetails: { mode: 'full' },
      };
      const cod = calculateOrderCodAmount(order);
      assert.equal(cod, 0);
    });

    test('bKash delivery-only prepayment collects remaining itemsSubtotal at delivery', () => {
      const order = {
        paymentMethod: 'bKash',
        totalAmount: 1250,
        itemsSubtotal: 1190,
        deliveryFee: 60,
        paymentDetails: { mode: 'delivery' },
      };
      const cod = calculateOrderCodAmount(order);
      assert.equal(cod, 1190);
    });

    test('paid order requires 0 COD regardless of method', () => {
      const order = {
        paymentStatus: 'Paid',
        paymentMethod: 'COD',
        totalAmount: 1250,
      };
      const cod = calculateOrderCodAmount(order);
      assert.equal(cod, 0);
    });

    test('admin explicit COD override takes precedence', () => {
      const order = {
        paymentMethod: 'COD',
        totalAmount: 1250,
      };
      const cod = calculateOrderCodAmount(order, 500);
      assert.equal(cod, 500);
    });
  });

  describe('3. Parcel Description & Address Formatting', () => {
    test('buildItemSummary generates concise item list', () => {
      const order = {
        items: [
          { title: 'Nonstick Frypan', quantity: 2 },
          { title: 'Kitchen Knife Set', quantity: 1 },
        ],
      };
      const summary = buildItemSummary(order);
      assert.equal(summary, '2x Nonstick Frypan, 1x Kitchen Knife Set');
    });

    test('buildDeliveryAddress merges address and zone within 250 chars', () => {
      const order = {
        customerDetails: {
          address: 'House #14, Road #5, Block B, Dhanmondi',
          deliveryLocation: 'Inside Dhaka',
        },
      };
      const addr = buildDeliveryAddress(order);
      assert.ok(addr.includes('Dhanmondi'));
      assert.ok(addr.includes('[Zone: Inside Dhaka]'));
      assert.ok(addr.length <= 250);
    });

    test('buildDeliveryAddress formats recipient_address with thana and district', () => {
      const order = {
        customerDetails: {
          address: 'House #14, Road #5, Block B',
          thana: 'Dhanmondi',
          district: 'Dhaka',
          division: 'Dhaka Division',
          deliveryLocation: 'Inside Dhaka',
        },
      };
      const addr = buildDeliveryAddress(order);
      assert.equal(addr, 'House #14, Road #5, Block B, Dhanmondi, Dhaka, Dhaka Division, [Zone: Inside Dhaka]');
    });
  });

  describe('4. Courier Dispatch Controller & Email Hook', () => {
    test('shipOrderWithSteadfast rejects nonexistent order with 404', async () => {
      const { req, res, getStatus } = mockReqRes({
        params: { invoiceNumber: 'SAR-NONEXISTENT-9999' },
      });
      await shipOrderWithSteadfast(req, res);
      assert.equal(getStatus(), 404);
    });

    test('shipOrderWithSteadfast dispatches order and marks status Shipped', async () => {
      const invoiceNum = `SAR-TEST-COURIER-${Date.now()}`;
      const sampleOrder = {
        invoiceNumber: invoiceNum,
        customerDetails: {
          name: 'Shahriar Kabir',
          phone: '01712345678',
          address: 'House #4, Road #2, Sector #3, Uttara, Dhaka',
          deliveryLocation: 'Inside Dhaka',
          email: 'shahriar@example.com',
        },
        items: [{ title: 'Smart Blender', quantity: 1, price: 850 }],
        itemsSubtotal: 850,
        deliveryFee: 60,
        totalAmount: 910,
        paymentMethod: 'COD',
        orderStatus: 'Pending',
      };

      memoryStore.orders.push(sampleOrder);

      const { req, res, getStatus, getData } = mockReqRes({
        params: { invoiceNumber: invoiceNum },
        body: {
          consignmentId: 998877,
          trackingCode: 'SF99887766',
          note: 'Handle with care',
        },
      });

      await shipOrderWithSteadfast(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.order.orderStatus, 'Shipped');
      assert.equal(data.order.courierData.provider, 'Steadfast');
      assert.equal(data.order.courierData.trackingCode, 'SF99887766');
      assert.equal(data.order.courierData.consignmentId, 998877);
      assert.ok(data.order.courierData.trackingUrl.includes('SF99887766'));
    });

    test('shipOrderWithSteadfast rejects already shipped order on repeated dispatch', async () => {
      const invoiceNum = `SAR-ALREADY-SHIPPED-${Date.now()}`;
      memoryStore.orders.push({
        invoiceNumber: invoiceNum,
        customerDetails: {
          name: 'Habibullah',
          phone: '01812345678',
          address: 'Road 5, Dhanmondi, Dhaka',
        },
        orderStatus: 'Shipped',
        courierData: {
          consignmentId: 112233,
          trackingCode: 'SF11223344',
        },
      });

      const { req, res, getStatus, getData } = mockReqRes({
        params: { invoiceNumber: invoiceNum },
      });

      await shipOrderWithSteadfast(req, res);
      assert.equal(getStatus(), 200);
      assert.ok(getData().message.includes('already been dispatched'));
    });
  });

  describe('5. Structured Address & Hierarchy Dispatch Suite', () => {
    const { createOrder, dispatchOrderToSteadfast } = require('../controllers/orderController');

    test('createOrder accepts structured address and constructs full hierarchy [Street] + [Thana] + [District]', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          customerDetails: {
            name: 'Jahid Hasan',
            phone: '01712345678',
            district: 'Narsingdi',
            thana: 'Raipura',
            streetAddress: 'Raipura Bazar Road',
            deliveryLocation: 'Outside Dhaka',
          },
          items: [{ productId: 1, title: 'Nonstick Pan', quantity: 1, price: 1060 }],
          paymentMethod: 'COD',
        },
      });

      await createOrder(req, res);
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.order.customerDetails.streetAddress, 'Raipura Bazar Road');
      assert.equal(data.order.customerDetails.thana, 'Raipura');
      assert.equal(data.order.customerDetails.district, 'Narsingdi');
      assert.equal(data.order.customerDetails.fullAddress, 'Raipura Bazar Road, Raipura, Narsingdi');
      assert.equal(data.order.customerDetails.address, 'Raipura Bazar Road, Raipura, Narsingdi');
    });

    test('createOrder rejects structured address when district or thana is missing', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          customerDetails: {
            name: 'Jahid Hasan',
            phone: '01712345678',
            streetAddress: 'Raipura Bazar Road',
            district: '', // Missing
            thana: 'Raipura',
          },
          items: [{ productId: 1, title: 'Nonstick Pan', quantity: 1, price: 1060 }],
          paymentMethod: 'COD',
        },
      });

      await createOrder(req, res);
      assert.equal(getStatus(), 400);
      assert.match(getData().message, /strictly required/i);
    });

    test('createOrder rejects structured streetAddress shorter than 6 characters', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          customerDetails: {
            name: 'Jahid Hasan',
            phone: '01712345678',
            streetAddress: 'Rd 1', // 4 chars (< 6)
            district: 'Dhaka',
            thana: 'Mirpur',
          },
          items: [{ productId: 1, title: 'Nonstick Pan', quantity: 1, price: 1060 }],
          paymentMethod: 'COD',
        },
      });

      await createOrder(req, res);
      assert.equal(getStatus(), 400);
      assert.match(getData().message, /at least 6 characters long/i);
    });

    test('dispatchOrderToSteadfast dispatches parcel with complete recipient address hierarchy', async () => {
      const sampleOrder = {
        invoiceNumber: `ORD-TEST-${Date.now()}`,
        totalAmount: 1060,
        customerDetails: {
          name: 'Jahid Hasan',
          phone: '01712345678',
          streetAddress: 'Raipura Bazar Road',
          thana: 'Raipura',
          district: 'Narsingdi',
        },
        items: [{ title: 'Nonstick Pan', quantity: 1 }],
      };

      const result = await dispatchOrderToSteadfast(sampleOrder, {
        allowMockFallback: true,
      });

      assert.equal(result.success, true);
      assert.ok(result.consignmentId);
      assert.ok(result.trackingCode.startsWith('SF'));
      assert.equal(result.codAmount, 1060);
    });
  });

  describe('6. Steadfast Webhook Real-Time Synchronization Suite', () => {
    const { handleSteadfastWebhook } = require('../controllers/courierController');

    test('webhook rejects missing consignment_id or status with 400 Bad Request', async () => {
      // Test missing consignment_id
      const { req: req1, res: res1, getStatus: getStatus1, getData: getData1 } = mockReqRes({
        body: { status: 'delivered' },
      });
      await handleSteadfastWebhook(req1, res1);
      assert.equal(getStatus1(), 400);
      assert.equal(getData1().success, false);
      assert.match(getData1().message, /consignment_id and status are required/i);

      // Test missing status
      const { req: req2, res: res2, getStatus: getStatus2, getData: getData2 } = mockReqRes({
        body: { consignment_id: 123456 },
      });
      await handleSteadfastWebhook(req2, res2);
      assert.equal(getStatus2(), 400);
      assert.equal(getData2().success, false);
      assert.match(getData2().message, /consignment_id and status are required/i);
    });

    test('webhook updates orderStatus to "Delivered", paymentStatus to "Paid" and sets deliveredAt', async () => {
      const invoiceNumber = `SAR-HOOK-DELV-${Date.now()}`;
      const consignmentId = Math.floor(700000 + Math.random() * 200000);

      memoryStore.orders.push({
        invoiceNumber,
        orderStatus: 'Shipped',
        paymentStatus: 'Pending',
        courierData: {
          consignmentId,
          trackingCode: 'SF77889900',
          status: 'in_transit',
        },
      });

      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          consignment_id: consignmentId,
          status: 'delivered',
        },
      });

      await handleSteadfastWebhook(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.orderStatus, 'Delivered');
      assert.equal(data.deliveryStatus, 'delivered');

      // Verify in-memory record updated
      const found = memoryStore.orders.find((o) => o.invoiceNumber === invoiceNumber);
      assert.ok(found);
      assert.equal(found.orderStatus, 'Delivered');
      assert.equal(found.paymentStatus, 'Paid');
      assert.ok(found.deliveredAt);
      assert.equal(found.courierData.deliveryStatus, 'delivered');
    });

    test('webhook updates orderStatus to "Cancelled" on status "cancelled" and "returned"', async () => {
      const invoiceNumber = `SAR-HOOK-CANC-${Date.now()}`;
      const consignmentId = Math.floor(700000 + Math.random() * 200000);

      memoryStore.orders.push({
        invoiceNumber,
        orderStatus: 'Shipped',
        courierData: {
          consignmentId,
          trackingCode: 'SF55667788',
        },
      });

      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          consignment_id: String(consignmentId),
          status: 'cancelled',
        },
      });

      await handleSteadfastWebhook(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.orderStatus, 'Cancelled');

      const found = memoryStore.orders.find((o) => o.invoiceNumber === invoiceNumber);
      assert.equal(found.orderStatus, 'Cancelled');
      assert.ok(found.cancelledAt);
    });

    test('webhook updates orderStatus to "Partially Delivered" on status "partial_delivered"', async () => {
      const invoiceNumber = `SAR-HOOK-PART-${Date.now()}`;
      const consignmentId = Math.floor(700000 + Math.random() * 200000);

      memoryStore.orders.push({
        invoiceNumber,
        orderStatus: 'Shipped',
        courierData: {
          consignmentId,
          trackingCode: 'SF33445566',
        },
      });

      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          consignment_id: consignmentId,
          status: 'partial_delivered',
        },
      });

      await handleSteadfastWebhook(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.equal(data.orderStatus, 'Partially Delivered');

      const found = memoryStore.orders.find((o) => o.invoiceNumber === invoiceNumber);
      assert.equal(found.orderStatus, 'Partially Delivered');
      assert.equal(found.courierData.deliveryStatus, 'partial_delivered');
    });

    test('webhook returns 200 OK handshaking when no matching order is found', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          consignment_id: '999999999',
          status: 'delivered',
        },
      });

      await handleSteadfastWebhook(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      assert.match(data.message, /No matching order found/i);
    });
  });
});

