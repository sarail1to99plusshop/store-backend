const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Review = require('../models/Review');
const Order = require('../models/Order');
const {
  initialProducts,
  initialCategories,
  initialReviews,
  initialOrders,
} = require('../data/seedData');

// Global cache for Vercel Serverless environment
let cached = global.mongooseCache;
if (!cached) {
  cached = global.mongooseCache = {
    conn: null,
    promise: null,
    seeded: false,
    lastAttempt: 0,
  };
}

const isMongoConnected = () => mongoose.connection.readyState === 1;

const seedDatabaseIfEmpty = async () => {
  if (cached.seeded || !isMongoConnected()) return;

  try {
    const productCount = await Product.countDocuments();
    if (productCount === 0) {
      await Product.insertMany(initialProducts);
      console.log(`[MongoDB] Seeded ${initialProducts.length} products.`);
    }

    const categoryCount = await Category.countDocuments();
    if (categoryCount === 0) {
      await Category.insertMany(initialCategories);
      console.log(`[MongoDB] Seeded ${initialCategories.length} categories.`);
    }

    const orderCount = await Order.countDocuments();
    if (orderCount === 0) {
      await Order.insertMany(initialOrders);
      console.log(`[MongoDB] Seeded ${initialOrders.length} sample order.`);
    }

    cached.seeded = true;
  } catch (err) {
    console.warn('[MongoDB] Auto-seed check warning:', err.message);
  }
};

const tryConnect = async (uri) => {
  return mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    bufferCommands: false,
  });
};

const connectDB = async () => {
  if (cached.conn && isMongoConnected()) {
    return cached.conn;
  }

  const primaryUri = process.env.MONGODB_URI;
  const altUri = process.env.MONGODB_URI_ALT;
  if (!primaryUri) {
    return null;
  }

  const now = Date.now();
  if (!cached.promise && now - cached.lastAttempt < 10000 && cached.lastAttempt !== 0) {
    return null;
  }

  if (!cached.promise) {
    cached.lastAttempt = now;
    cached.promise = (async () => {
      try {
        const mongooseInstance = await tryConnect(primaryUri);
        console.log(`[MongoDB] Connected successfully: ${mongooseInstance.connection.host}`);
        await seedDatabaseIfEmpty();
        return mongooseInstance;
      } catch (primaryErr) {
        if (altUri && altUri !== primaryUri) {
          try {
            const altInstance = await tryConnect(altUri);
            console.log(`[MongoDB] Connected successfully via alt URI: ${altInstance.connection.host}`);
            await seedDatabaseIfEmpty();
            return altInstance;
          } catch (altErr) {
            console.error(`[MongoDB] Connection failed: ${altErr.message}`);
            cached.promise = null;
            return null;
          }
        }
        console.error(`[MongoDB] Connection failed: ${primaryErr.message}`);
        cached.promise = null;
        return null;
      }
    })();
  }

  cached.conn = await cached.promise;
  return cached.conn;
};

module.exports = { connectDB, isMongoConnected, seedDatabaseIfEmpty };
