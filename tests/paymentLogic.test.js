const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createOrder } = require('../controllers/orderController');

// Helper to mock Express req and res
function mockReqRes(body = {}) {
  const req = { body };
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

describe('bKash & COD Payment Integrity Logic', () => {
  const baseCustomerDetails = {
    name: 'Rahim Uddin',
    phone: '01711000000',
    address: 'Bikal Bazar, Sarail',
  };

  const sampleItems = [
    { title: 'Item 1', price: 300, quantity: 1 },
    { title: 'Item 2', price: 200, quantity: 1 },
  ]; // Subtotal: 500

  test('1. Cash On Delivery (COD): expectedAmount is 0 and full invoice is due at delivery', async () => {
    const { req, res, getStatus, getData } = mockReqRes({
      customerDetails: baseCustomerDetails,
      items: sampleItems,
      deliveryFee: 60,
      paymentMethod: 'COD',
    });

    await createOrder(req, res);

    assert.equal(getStatus(), 201);
    const data = getData();
    assert.equal(data.success, true);
    assert.equal(data.order.paymentMethod, 'COD');
    assert.equal(data.order.itemsSubtotal, 500);
    assert.equal(data.order.deliveryFee, 60);
    assert.equal(data.order.totalAmount, 560);
    assert.equal(data.order.paymentDetails.expectedAmount, 0);

    // Due at delivery
    const dueAmount = data.order.totalAmount - data.order.paymentDetails.expectedAmount;
    assert.equal(dueAmount, 560);
  });

  test('2. bKash Full Payment: expectedAmount is computedTotal (560) and due at delivery is 0', async () => {
    const { req, res, getStatus, getData } = mockReqRes({
      customerDetails: baseCustomerDetails,
      items: sampleItems,
      deliveryFee: 60,
      paymentMethod: 'bKash',
      paymentDetails: {
        mode: 'full',
        trxId: 'TRXFULL12345',
        senderPhone: '01998789157',
      },
    });

    await createOrder(req, res);

    assert.equal(getStatus(), 201);
    const data = getData();
    assert.equal(data.success, true);
    assert.equal(data.order.paymentMethod, 'bKash');
    assert.equal(data.order.paymentDetails.mode, 'full');
    assert.equal(data.order.itemsSubtotal, 500);
    assert.equal(data.order.deliveryFee, 60);
    assert.equal(data.order.totalAmount, 560);
    assert.equal(data.order.paymentDetails.expectedAmount, 560);

    // Due at delivery
    const dueAmount = data.order.totalAmount - data.order.paymentDetails.expectedAmount;
    assert.equal(dueAmount, 0);
  });

  test('3. bKash Delivery Charge Only: expectedAmount is deliveryFee (60) and due at delivery is itemsSubtotal (500)', async () => {
    const { req, res, getStatus, getData } = mockReqRes({
      customerDetails: baseCustomerDetails,
      items: sampleItems,
      deliveryFee: 60,
      paymentMethod: 'bKash',
      paymentDetails: {
        mode: 'delivery',
        trxId: 'TRXDELV12345',
        senderPhone: '01998789157',
      },
    });

    await createOrder(req, res);

    assert.equal(getStatus(), 201);
    const data = getData();
    assert.equal(data.success, true);
    assert.equal(data.order.paymentMethod, 'bKash');
    assert.equal(data.order.paymentDetails.mode, 'delivery');
    assert.equal(data.order.itemsSubtotal, 500);
    assert.equal(data.order.deliveryFee, 60);
    assert.equal(data.order.totalAmount, 560);
    assert.equal(data.order.paymentDetails.expectedAmount, 60);

    // Due at delivery equals subtotal
    const dueAmount = data.order.totalAmount - data.order.paymentDetails.expectedAmount;
    assert.equal(dueAmount, 500);
    assert.equal(dueAmount, data.order.itemsSubtotal);
  });

  test('4. Invoice Total Invariance: totalAmount is strictly itemsSubtotal + deliveryFee in all modes', async () => {
    const modes = [
      { method: 'COD', mode: undefined, trx: undefined, expectedDue: 560 },
      { method: 'bKash', mode: 'full', trx: 'TRXFULL8888', expectedDue: 0 },
      { method: 'bKash', mode: 'delivery', trx: 'TRXDELV8888', expectedDue: 500 },
    ];

    for (const config of modes) {
      const { req, res, getStatus, getData } = mockReqRes({
        customerDetails: baseCustomerDetails,
        items: sampleItems,
        deliveryFee: 60,
        paymentMethod: config.method,
        paymentDetails: config.mode ? { mode: config.mode, trxId: config.trx } : undefined,
      });

      await createOrder(req, res);
      assert.equal(getStatus(), 201);
      const data = getData();
      assert.equal(data.order.totalAmount, 560, `Failed totalAmount invariance for ${config.method}/${config.mode}`);
      assert.equal(data.order.itemsSubtotal + data.order.deliveryFee, 560);
    }
  });

  test('5. Rejects invalid bKash payment mode with status 400', async () => {
    const { req, res, getStatus, getData } = mockReqRes({
      customerDetails: baseCustomerDetails,
      items: sampleItems,
      deliveryFee: 60,
      paymentMethod: 'bKash',
      paymentDetails: {
        mode: 'invalid_mode',
        trxId: 'TRXINV12345',
      },
    });

    await createOrder(req, res);

    assert.equal(getStatus(), 400);
    const data = getData();
    assert.equal(data.success, false);
    assert.match(data.message, /Invalid bKash payment mode/i);
  });

  test('6. Rejects delivery mode when deliveryFee is 0 with status 400', async () => {
    const { req, res, getStatus, getData } = mockReqRes({
      customerDetails: baseCustomerDetails,
      items: sampleItems,
      deliveryFee: 0,
      paymentMethod: 'bKash',
      paymentDetails: {
        mode: 'delivery',
        trxId: 'TRXDELVZERO',
      },
    });

    await createOrder(req, res);

    assert.equal(getStatus(), 400);
    const data = getData();
    assert.equal(data.success, false);
    assert.match(data.message, /Delivery charge only mode requires a delivery fee greater than zero/i);
  });

  test('7. Rejects bKash payment when TrxID is missing or too short with status 400', async () => {
    const { req, res, getStatus, getData } = mockReqRes({
      customerDetails: baseCustomerDetails,
      items: sampleItems,
      deliveryFee: 60,
      paymentMethod: 'bKash',
      paymentDetails: {
        mode: 'full',
        trxId: '',
      },
    });

    await createOrder(req, res);

    assert.equal(getStatus(), 400);
    const data = getData();
    assert.equal(data.success, false);
    assert.match(data.message, /Transaction ID \(TrxID\) is required/i);
  });
});

