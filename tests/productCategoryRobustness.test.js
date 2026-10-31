const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createProductAdmin, updateProductAdmin } = require('../controllers/adminController');

describe('Product Category Type Safety & Robustness Suite', () => {
  const createMockRes = () => {
    const res = {
      statusCode: null,
      jsonData: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.jsonData = data;
        return this;
      },
    };
    return res;
  };

  test('1. createProductAdmin handles category as an object { id, name } without crashing', async () => {
    const req = {
      body: {
        name: 'Test Pressure Cooker',
        price: 1250,
        category: { id: 'kitchen', name: 'Kitchen & Dining' },
        thumbnail: 'https://i.ibb.co/test-cooker.webp',
        description: 'Quality Cooker',
      },
    };
    const res = createMockRes();

    await createProductAdmin(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.jsonData.success, true);
    assert.equal(res.jsonData.product.category, 'kitchen');
  });

  test('2. createProductAdmin handles category as an array of categories', async () => {
    const req = {
      body: {
        name: 'Test Spin Mop',
        price: 650,
        category: [{ id: 'cleaning', name: 'Cleaning & Hygiene' }],
        thumbnail: 'https://i.ibb.co/test-mop.webp',
      },
    };
    const res = createMockRes();

    await createProductAdmin(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.jsonData.success, true);
    assert.equal(res.jsonData.product.category, 'cleaning');
  });

  test('3. createProductAdmin handles category as a string', async () => {
    const req = {
      body: {
        name: 'Test Melamine Dinner Set',
        price: 2200,
        category: 'melamine-crockery',
        thumbnail: 'https://i.ibb.co/test-set.webp',
      },
    };
    const res = createMockRes();

    await createProductAdmin(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.jsonData.success, true);
    assert.equal(res.jsonData.product.category, 'melamine-crockery');
  });

  test('4. updateProductAdmin safely parses category object { id }', async () => {
    const req = {
      params: { id: '1' },
      body: {
        category: { id: 'beauty', name: 'Beauty & Personal Care' },
      },
    };
    const res = createMockRes();

    await updateProductAdmin(req, res);

    // Either 200 or 404 (if id 1 not in DB), but MUST NOT throw TypeError: category.trim is not a function
    assert.ok(res.statusCode === 200 || res.statusCode === 404);
  });
});

