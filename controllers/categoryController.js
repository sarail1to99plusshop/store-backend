const Category = require('../models/Category');
const { isMongoConnected } = require('../config/db');
const { memoryStore, initialDeliveryCharges } = require('../data/seedData');

// GET /api/categories
const getCategories = async (req, res) => {
  try {
    if (isMongoConnected()) {
      const categories = await Category.find().lean();
      return res.status(200).json({
        success: true,
        categories: categories.length > 0 ? categories : memoryStore.categories,
      });
    }

    return res.status(200).json({
      success: true,
      categories: memoryStore.categories,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch categories.',
      error: error.message,
    });
  }
};

// GET /api/delivery-charges
const getDeliveryCharges = async (req, res) => {
  return res.status(200).json({
    success: true,
    deliveryCharges: initialDeliveryCharges,
  });
};

module.exports = {
  getCategories,
  getDeliveryCharges,
};

