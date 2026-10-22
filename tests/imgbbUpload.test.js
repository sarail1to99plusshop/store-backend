const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { uploadImageToImgBBAdmin } = require('../controllers/adminController');

describe('ImgBB Permanent Upload Controller Suite', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.IMGBB_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.IMGBB_API_KEY = originalKey;
  });

  test('1. Rejects missing image payload with 400 Bad Request', async () => {
    let statusCode = null;
    let jsonResult = null;

    const req = { body: {} };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => {
            jsonResult = data;
          },
        };
      },
    };

    await uploadImageToImgBBAdmin(req, res);

    assert.equal(statusCode, 400);
    assert.equal(jsonResult.success, false);
    assert.match(jsonResult.message, /Image data.*required/i);
  });

  test('2. Rejects request with MISSING_IMGBB_KEY when IMGBB_API_KEY is unset', async () => {
    delete process.env.IMGBB_API_KEY;

    let statusCode = null;
    let jsonResult = null;

    const req = {
      body: {
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        name: 'test-product.png',
      },
    };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => {
            jsonResult = data;
          },
        };
      },
    };

    await uploadImageToImgBBAdmin(req, res);

    assert.equal(statusCode, 500);
    assert.equal(jsonResult.success, false);
    assert.equal(jsonResult.code, 'MISSING_IMGBB_KEY');
  });

  test('3. Permanently uploads image to ImgBB and verifies no expiration parameter is passed', async () => {
    process.env.IMGBB_API_KEY = 'test_imgbb_secret_key_12345';

    let capturedUrl = null;
    let capturedMethod = null;
    let capturedBody = null;

    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      capturedBody = options.body;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          status: 200,
          data: {
            id: 'sampleId123',
            title: 'test-product',
            url: 'https://i.ibb.co/3Y1vdrdt/test-product.png',
            display_url: 'https://i.ibb.co/3Y1vdrdt/test-product.png',
            expiration: 0,
          },
        }),
      };
    };

    let statusCode = null;
    let jsonResult = null;

    const req = {
      body: {
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        name: 'test-product.png',
      },
    };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => {
            jsonResult = data;
          },
        };
      },
    };

    await uploadImageToImgBBAdmin(req, res);

    assert.equal(statusCode, 200);
    assert.equal(jsonResult.success, true);
    assert.equal(jsonResult.url, 'https://i.ibb.co/3Y1vdrdt/test-product.png');

    // Verify correct ImgBB endpoint called with key
    assert.match(capturedUrl, /^https:\/\/api\.imgbb\.com\/1\/upload\?key=test_imgbb_secret_key_12345/);
    assert.equal(capturedMethod, 'POST');

    // CRITICAL: Verify expiration is NOT sent, ensuring permanent storage
    const parsedBody = new URLSearchParams(capturedBody);
    assert.equal(parsedBody.has('expiration'), false, 'Expiration must NOT be sent so image is permanent');
    assert.equal(parsedBody.get('name'), 'test-product.png');
    assert.ok(parsedBody.get('image'), 'Image data must be provided');
  });

  test('4. Handles ImgBB API error response with status and message forwarding', async () => {
    process.env.IMGBB_API_KEY = 'invalid_key';

    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        status: 400,
        error: {
          message: 'Invalid API key',
          code: 100,
        },
      }),
    });

    let statusCode = null;
    let jsonResult = null;

    const req = {
      body: {
        image: 'sampleBase64',
      },
    };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => {
            jsonResult = data;
          },
        };
      },
    };

    await uploadImageToImgBBAdmin(req, res);

    assert.equal(statusCode, 400);
    assert.equal(jsonResult.success, false);
    assert.equal(jsonResult.message, 'Invalid API key');
  });
});

