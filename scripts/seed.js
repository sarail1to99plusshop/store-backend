require('dotenv').config();
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

const runSeed = async () => {
  try {
    const primaryUri = process.env.MONGODB_URI;
    const altUri = process.env.MONGODB_URI_ALT;
    if (!primaryUri) {
      console.error('Error: MONGODB_URI is not defined in .env');
      process.exit(1);
    }

    try {
      await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 8000 });
      console.log('Connected to MongoDB Atlas (primary URI) for seeding...');
    } catch (primaryErr) {
      if (altUri) {
        await mongoose.connect(altUri, { serverSelectionTimeoutMS: 8000 });
        console.log('Connected to MongoDB Atlas (alt URI) for seeding...');
      } else {
        throw primaryErr;
      }
    }

    await Product.deleteMany({});
    await Category.deleteMany({});
    await Review.deleteMany({});

    await Product.insertMany(initialProducts);
    console.log(`Inserted ${initialProducts.length} products.`);

    await Category.insertMany(initialCategories);
    console.log(`Inserted ${initialCategories.length} categories.`);
    console.log('Cleared all pre-existing reviews (0 pre-reviews; ratings start at 0).');

    const existingOrders = await Order.countDocuments();
    if (existingOrders === 0) {
      await Order.insertMany(initialOrders);
      console.log(`Inserted ${initialOrders.length} sample orders.`);
    }

    console.log('Database seeded successfully!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
};

runSeed();
