const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getColorName } = require('../utils/colorNames');
const { createProductAdmin, updateProductAdmin } = require('../controllers/adminController');

describe('Automatic Color Name Detection & Harmonization Suite', () => {
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

  test('1. accurately resolves exact standard color codes', () => {
    assert.equal(getColorName('#000000'), 'Black');
    assert.equal(getColorName('#FFFFFF'), 'White');
    assert.equal(getColorName('#EF4444'), 'Red');
    assert.equal(getColorName('#3B82F6'), 'Blue');
    assert.equal(getColorName('#10B981'), 'Emerald Green');
    assert.equal(getColorName('#F59E0B'), 'Amber');
    assert.equal(getColorName('#8B5CF6'), 'Purple');
    assert.equal(getColorName('#1E3A8A'), 'Navy Blue');
    assert.equal(getColorName('#EC4899'), 'Pink');
  });

  test('2. handles 3-digit shorthand and lowercase hex codes', () => {
    assert.equal(getColorName('#000'), 'Black');
    assert.equal(getColorName('#fff'), 'White');
    assert.equal(getColorName('#f00'), 'Red');
    assert.equal(getColorName('#3b82f6'), 'Blue');
  });

  test('3. gracefully resolves arbitrary shades via perceptual redmean color distance', () => {
    const darkRedName = getColorName('#D12020');
    assert.ok(['Crimson', 'Dark Red', 'Red'].includes(darkRedName), `Unexpected color name: ${darkRedName}`);

    const skyBlueName = getColorName('#38BDF8');
    assert.ok(['Sky Blue', 'Light Blue', 'Blue'].includes(skyBlueName), `Unexpected color name: ${skyBlueName}`);

    const deepDark = getColorName('#0F172A');
    assert.ok(typeof deepDark === 'string' && deepDark.length > 0);
  });

  test('4. auto-populates colorName in createProductAdmin when variant colorName is omitted or blank', async () => {
    const req = {
      body: {
        name: 'Auto Color Test Product',
        price: 999,
        category: 'kitchen',
        variants: [
          { colorCode: '#10B981', images: ['https://example.com/green.jpg'] },
          { colorCode: '#EF4444', colorName: '', images: ['https://example.com/red.jpg'] },
          { colorCode: '#000000', colorName: 'Custom Midnight', images: ['https://example.com/black.jpg'] },
        ],
      },
    };
    const res = createMockRes();

    await createProductAdmin(req, res);

    assert.equal(res.statusCode, 201);
    assert.ok(res.jsonData && res.jsonData.product);

    const createdVariants = res.jsonData.product.variants;
    assert.equal(createdVariants.length, 3);
    assert.equal(createdVariants[0].colorName, 'Emerald Green');
    assert.equal(createdVariants[1].colorName, 'Red');
    assert.equal(createdVariants[2].colorName, 'Custom Midnight');
  });

  test('5. auto-populates colorName in updateProductAdmin when updated variant colorName is blank', async () => {
    const req = {
      params: { id: '1' },
      body: {
        variants: [
          { colorCode: '#3B82F6', colorName: '', images: ['https://example.com/blue.jpg'] },
        ],
      },
    };
    const res = createMockRes();

    await updateProductAdmin(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonData && res.jsonData.product);
    assert.equal(res.jsonData.product.variants[0].colorName, 'Blue');
  });
});
