/**
 * Tag Migration Script for Sarail 1 to 99+ Shop
 * Normalizes all product tags in MongoDB to the 4 official tags:
 * 1. Best Selling
 * 2. New Arrivals
 * 3. Hot Offer
 * 4. Popular / Hit Items
 * Removes all legacy/unauthorized tags (like 'Daily Essential').
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Product = require('../models/Product');
const { normalizeProductTag, OFFICIAL_PRODUCT_TAGS } = require('../utils/productTags');

async function migrateTags() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI_ALT;
  if (!mongoUri) {
    console.error('No MONGODB_URI found in environment.');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB successfully.');

    const products = await Product.find({});
    console.log(`Found ${products.length} products to check...`);

    let updatedCount = 0;
    for (const prod of products) {
      const originalTag = prod.tag;
      const normalized = normalizeProductTag(originalTag, prod.collections);

      if (originalTag !== normalized) {
        prod.tag = normalized;
        await prod.save();
        console.log(`Updated Product #${prod.id} "${prod.name}": tag "${originalTag}" -> "${normalized}"`);
        updatedCount++;
      }
    }

    console.log(`Migration completed. ${updatedCount} products updated.`);
    console.log('Allowed tags in catalog:', OFFICIAL_PRODUCT_TAGS);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  migrateTags();
}

module.exports = migrateTags;

