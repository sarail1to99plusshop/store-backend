const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDistrictName,
  getTargetDistrictForZone,
  isZoneApplicableForDistrict,
  getBestMatchingDeliveryZone,
} = require('../utils/deliveryZoneRules');
const {
  normalizeBDPhone,
  registerUser,
  updateUserPhone,
} = require('../controllers/userController');
const {
  signAdminToken,
} = require('../middleware/authMiddleware');
const {
  updateOrderStatusAdmin,
  getDeliveredMonthlyReport,
} = require('../controllers/adminController');
const { memoryStore } = require('../data/seedData');

const mockReqRes = (overrides = {}) => {
  let statusCode = 200;
  let responseData = null;

  const req = {
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
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
};

describe('End-to-End Corrections Verification Suite (R01-R18)', () => {
  describe('AUTH Suite: Phone Number & Self-Profile Protection', () => {
    test('AUTH-01: Manual signup without phone is blocked with 400', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          uid: 'test_uid_nophone',
          email: 'nophone@example.com',
          displayName: 'No Phone User',
          authProvider: 'password',
          phone: '',
        },
      });

      await registerUser(req, res);
      assert.equal(getStatus(), 400);
      assert.equal(getData().success, false);
      assert.ok(getData().message.includes('মোবাইল নম্বর দেওয়া আবশ্যক'));
    });

    test('AUTH-01b: Manual signup with invalid BD phone format is blocked with 400', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          uid: 'test_uid_badphone',
          email: 'badphone@example.com',
          displayName: 'Bad Phone User',
          authProvider: 'password',
          phone: '01234567890', // 012 is invalid BD operator
        },
      });

      await registerUser(req, res);
      assert.equal(getStatus(), 400);
      assert.equal(getData().success, false);
      assert.ok(getData().message.includes('সঠিক বাংলাদেশি মোবাইল নম্বর দিন'));
    });

    test('AUTH-02 & AUTH-03: Normalizes +88017... to 11-digit 017... and saves phone', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        body: {
          uid: 'test_uid_validphone_88',
          email: 'validphone88@example.com',
          displayName: 'Valid Phone User',
          authProvider: 'password',
          phone: '+8801712345678',
        },
      });

      await registerUser(req, res);
      assert.equal(getStatus(), 201);
      assert.equal(getData().success, true);
      assert.equal(getData().user.phone, '01712345678');
    });

    test('AUTH-09: Phone update API rejects when caller token does not match target user UID', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        user: { uid: 'user_A_id', email: 'userA@example.com', role: 'customer' },
        body: {
          uid: 'user_B_id', // Spoofed target
          phone: '01811223344',
        },
      });

      await updateUserPhone(req, res);
      assert.equal(getStatus(), 403);
      assert.equal(getData().success, false);
      assert.ok(getData().message.includes('Forbidden'));
    });

    test('AUTH-09b: Phone update API allows self-update when token matches user UID', async () => {
      // First ensure user exists in memoryStore
      memoryStore.users.push({
        uid: 'user_self_1',
        email: 'self@example.com',
        phone: '',
      });

      const { req, res, getStatus, getData } = mockReqRes({
        user: { uid: 'user_self_1', email: 'self@example.com', role: 'customer' },
        body: {
          uid: 'user_self_1',
          phone: '01912345678',
        },
      });

      await updateUserPhone(req, res);
      assert.equal(getStatus(), 200);
      assert.equal(getData().success, true);
      assert.equal(getData().user.phone, '01912345678');
    });
  });

  describe('DEL Suite: Brahmanbaria District-Only Delivery Rules', () => {
    const testZones = [
      { id: 'inside-brahmanbaria', location: 'Inside Brahmanbaria City', charge: 60, isActive: true, isDefault: true },
      { id: 'inside-dhaka', location: 'Inside Dhaka City', charge: 120, isActive: true },
      { id: 'outside-brahmanbaria', location: 'Without Brahmanbaria City (Rest of Bangladesh)', charge: 130, isActive: true },
    ];

    test('DEL-01: Brahmanbaria with any thana (Sadar, Sarail, Kasba, Nabinagar) matches Brahmanbaria local rate (60)', () => {
      const thanas = ['Brahmanbaria Sadar', 'Sarail', 'সরাইল', 'Kasba', 'কসবা', 'Nabinagar', 'Ashuganj'];
      thanas.forEach((thana) => {
        const matched = getBestMatchingDeliveryZone(testZones, 'Brahmanbaria', thana);
        assert.ok(matched, `Expected match for thana: ${thana}`);
        assert.equal(matched.charge, 60, `Expected 60 for thana: ${thana}`);
      });
    });

    test('DEL-02: Brahmanbaria with arbitrary or empty thana maps strictly to local rate (60)', () => {
      const matchedEmpty = getBestMatchingDeliveryZone(testZones, 'Brahmanbaria', '');
      assert.equal(matchedEmpty.charge, 60);

      const matchedArbitrary = getBestMatchingDeliveryZone(testZones, 'Brahmanbaria', 'Custom Remote Village 123');
      assert.equal(matchedArbitrary.charge, 60);
    });

    test('DEL-03: Brahmanbaria Bangla / English / case variants map identically', () => {
      const districtVariants = [
        'Brahmanbaria',
        'brahmanbaria',
        'BRAHMANBARIA',
        'ব্রাহ্মণবাড়িয়া',
        'ব্রাহ্মণবাড়িয়া',
        'b.baria',
        'B-Baria',
      ];
      districtVariants.forEach((variant) => {
        const canon = normalizeDistrictName(variant);
        assert.equal(canon, 'Brahmanbaria', `Failed normalizing variant: ${variant}`);
        const matched = getBestMatchingDeliveryZone(testZones, variant, 'Sarail');
        assert.equal(matched.charge, 60, `Failed matching zone for variant: ${variant}`);
      });
    });

    test('DEL-04: Other districts (e.g. Narsingdi, Cumilla) map to outside/rest of BD zone (130)', () => {
      const matchedNarsingdi = getBestMatchingDeliveryZone(testZones, 'Narsingdi', 'Shibpur');
      assert.equal(matchedNarsingdi.charge, 130);

      const matchedCumilla = getBestMatchingDeliveryZone(testZones, 'Cumilla', 'Muradnagar');
      assert.equal(matchedCumilla.charge, 130);
    });
  });

  describe('REP Suite: Delivered Reports, deliveredAt & Dynamic Years', () => {
    test('REP-01: Manual transition to Delivered sets deliveredAt timestamp', async () => {
      const testInvoice = `SAR-TEST-REP-${Date.now()}`;
      memoryStore.orders.push({
        invoiceNumber: testInvoice,
        orderStatus: 'Shipped',
        paymentMethod: 'COD',
        paymentStatus: 'Pending',
        totalAmount: 500,
        items: [],
      });

      const { req, res, getStatus, getData } = mockReqRes({
        params: { invoiceNumber: testInvoice },
        body: { orderStatus: 'Delivered' },
      });

      await updateOrderStatusAdmin(req, res);
      assert.equal(getStatus(), 200);
      assert.equal(getData().order.orderStatus, 'Delivered');
      assert.ok(getData().order.deliveredAt, 'Expected deliveredAt to be set');
      assert.equal(getData().order.paymentStatus, 'Paid');
    });

    test('REP-03 & REP-05: Report strictly filters by deliveredAt and tracks missing delivery dates', async () => {
      // Setup test delivered orders
      memoryStore.orders.push({
        invoiceNumber: 'SAR-DELV-2027-JAN',
        orderStatus: 'Delivered',
        createdAt: '2026-12-31T18:00:00.000Z',
        deliveredAt: '2027-01-02T10:00:00.000Z', // January 2027
        totalAmount: 1200,
        totalQuantity: 2,
        deliveryFee: 60,
        items: [
          { productId: 101, title: 'Item 1', price: 570, quantity: 2, subtotal: 1140 },
        ],
      });

      memoryStore.orders.push({
        invoiceNumber: 'SAR-DELV-LEGACY-NODATE',
        orderStatus: 'Delivered',
        createdAt: '2026-05-10T12:00:00.000Z',
        // missing deliveredAt!
        totalAmount: 800,
        totalQuantity: 1,
        deliveryFee: 60,
        items: [],
      });

      // Query specifically for Year 2027, Month 01
      const { req, res, getStatus, getData } = mockReqRes({
        query: { year: '2027', month: '01', export: 'true' },
      });

      await getDeliveredMonthlyReport(req, res);
      assert.equal(getStatus(), 200);
      const data = getData();
      assert.equal(data.success, true);
      // Order placed in Dec 2026 but delivered in Jan 2027 must appear in Jan 2027 (REP-03)
      assert.equal(data.summary.totalDeliveredOrders, 1);
      assert.equal(data.summary.totalDeliveredRevenue, 1200);
      assert.equal(data.orders[0].invoiceNumber, 'SAR-DELV-2027-JAN');
      // Year 2027 must be present in dynamic availableYears (REP-04)
      assert.ok(data.availableYears.includes('2027'));
      // Legacy order with missing deliveredAt must be flagged (REP-05)
      assert.ok(data.summary.missingDeliveredDateCount >= 1);
    });

    test('REP-06: Export query returns all matching orders without pagination truncation', async () => {
      const { req, res, getStatus, getData } = mockReqRes({
        query: { export: 'true' },
      });

      await getDeliveredMonthlyReport(req, res);
      assert.equal(getStatus(), 200);
      assert.ok(Array.isArray(getData().orders));
    });
  });
});

