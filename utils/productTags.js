/**
 * Official Product Tags for Sarail 1 to 99+ Shop
 * Exactly 4 authorized tags:
 * 1. Best Selling
 * 2. New Arrivals
 * 3. Hot Offer
 * 4. Popular / Hit Items
 */

const OFFICIAL_PRODUCT_TAGS = [
  'Best Selling',
  'New Arrivals',
  'Hot Offer',
  'Popular / Hit Items',
];

/**
 * Normalizes any tag input or collection flag strictly to one of the 4 official tags,
 * or empty string (''). Automatically strips legacy/invalid tags (e.g. 'Daily Essential').
 */
const normalizeProductTag = (rawTag, collections = {}) => {
  const str = String(rawTag || '').toLowerCase().trim();

  // 1. Best Selling
  if (
    str === 'best selling' ||
    str === 'bestselling' ||
    str.includes('best') ||
    collections?.bestSelling
  ) {
    if (str.includes('best') || (!rawTag && collections?.bestSelling)) {
      return 'Best Selling';
    }
  }

  // 2. New Arrivals
  if (
    str === 'new arrivals' ||
    str === 'new arrival' ||
    str === 'newarrivals' ||
    str.includes('new') ||
    str.includes('arrival') ||
    collections?.newArrival
  ) {
    if (str.includes('new') || str.includes('arrival') || (!rawTag && collections?.newArrival)) {
      return 'New Arrivals';
    }
  }

  // 3. Hot Offer
  if (
    str === 'hot offer' ||
    str === 'hotoffer' ||
    str.includes('hot') ||
    str.includes('deal') ||
    collections?.hotOffer
  ) {
    if (str.includes('hot') || str.includes('deal') || (!rawTag && collections?.hotOffer)) {
      return 'Hot Offer';
    }
  }

  // 4. Popular / Hit Items
  if (
    str.includes('popular') ||
    str.includes('hit') ||
    collections?.popular
  ) {
    return 'Popular / Hit Items';
  }

  // Direct case-insensitive match against official tags
  for (const official of OFFICIAL_PRODUCT_TAGS) {
    if (str === official.toLowerCase()) {
      return official;
    }
  }

  // All legacy tags (e.g. 'Daily Essential') or unrecognized strings are completely removed
  return '';
};

module.exports = {
  OFFICIAL_PRODUCT_TAGS,
  normalizeProductTag,
};

