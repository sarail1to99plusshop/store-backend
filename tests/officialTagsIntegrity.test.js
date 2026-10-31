const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { OFFICIAL_PRODUCT_TAGS, normalizeProductTag } = require('../utils/productTags');
const { getProducts } = require('../controllers/productController');
const { memoryStore } = require('../data/seedData');

describe('Official 4 Product Tags Integrity Suite', () => {
  test('1. Exactly 4 official tags are defined in the catalog', () => {
    assert.deepEqual(OFFICIAL_PRODUCT_TAGS, [
      'Best Selling',
      'New Arrivals',
      'Hot Offer',
      'Popular / Hit Items',
    ]);
  });

  test('2. Legacy and unauthorized tags (e.g. "Daily Essential") are completely stripped', () => {
    assert.equal(normalizeProductTag('Daily Essential'), '');
    assert.equal(normalizeProductTag('daily essential'), '');
    assert.equal(normalizeProductTag('Exclusive'), '');
    assert.equal(normalizeProductTag('Trending Item'), '');
    assert.equal(normalizeProductTag('Random Tag'), '');
  });

  test('3. Maps and retains the 4 official tags cleanly', () => {
    assert.equal(normalizeProductTag('Best Selling'), 'Best Selling');
    assert.equal(normalizeProductTag('bestselling'), 'Best Selling');
    assert.equal(normalizeProductTag('New Arrivals'), 'New Arrivals');
    assert.equal(normalizeProductTag('new arrival'), 'New Arrivals');
    assert.equal(normalizeProductTag('Hot Offer'), 'Hot Offer');
    assert.equal(normalizeProductTag('hot-offer'), 'Hot Offer');
    assert.equal(normalizeProductTag('Popular / Hit Items'), 'Popular / Hit Items');
    assert.equal(normalizeProductTag('popular'), 'Popular / Hit Items');
    assert.equal(normalizeProductTag('hit items'), 'Popular / Hit Items');
  });

  test('4. Infers official tag from collections if tag is empty', () => {
    assert.equal(normalizeProductTag('', { bestSelling: true }), 'Best Selling');
    assert.equal(normalizeProductTag('', { newArrival: true }), 'New Arrivals');
    assert.equal(normalizeProductTag('', { hotOffer: true }), 'Hot Offer');
    assert.equal(normalizeProductTag('', { popular: true }), 'Popular / Hit Items');
  });

  test('5. getProducts API returns all 4 official tags and filters out Daily Essential', async () => {
    // Seed in-memory products with different tags
    memoryStore.products = [
      { id: 101, name: 'Product A', price: 100, tag: 'Daily Essential', thumbnail: 'https://i.ibb.co/a.webp' },
      { id: 102, name: 'Product B', price: 200, tag: 'Best Selling', thumbnail: 'https://i.ibb.co/b.webp' },
      { id: 103, name: 'Product C', price: 300, tag: 'Hot Offer', thumbnail: 'https://i.ibb.co/c.webp' },
      { id: 104, name: 'Product D', price: 400, tag: 'Popular', thumbnail: 'https://i.ibb.co/d.webp' },
    ];

    let jsonResult = null;
    const req = { query: {} };
    const res = {
      status(code) {
        return {
          json(data) {
            jsonResult = data;
          },
        };
      },
    };

    await getProducts(req, res);

    assert.ok(jsonResult.success);
    assert.deepEqual(jsonResult.tags, OFFICIAL_PRODUCT_TAGS);
    
    // Check that Product A has no "Daily Essential" tag
    const prodA = jsonResult.products.find((p) => p.id === 101);
    assert.equal(prodA.tag, '');

    // Check that Product D has normalized tag
    const prodD = jsonResult.products.find((p) => p.id === 104);
    assert.equal(prodD.tag, 'Popular / Hit Items');
  });
});

