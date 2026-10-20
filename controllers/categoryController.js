const mongoose = require('mongoose');
const Category = require('../models/Category');
const { isMongoConnected } = require('../config/db');
const { memoryStore, initialDeliveryCharges } = require('../data/seedData');

// GET /api/categories
const getCategories = async (req, res) => {
  try {
    if (isMongoConnected()) {
      const categories = await Category.find().sort({ createdAt: 1 }).lean();
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

// POST /api/categories or POST /api/admin/categories
const createCategory = async (req, res) => {
  try {
    const { name, id } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required.',
      });
    }

    const cleanName = name.trim();
    // Generate id slug from provided id or category name
    let cleanId = (id || cleanName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!cleanId) {
      // Fallback for non-latin / Bangla names
      cleanId = `cat-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    }

    if (isMongoConnected()) {
      const existing = await Category.findOne({
        $or: [
          { id: cleanId },
          { name: { $regex: new RegExp(`^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        ],
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Category "${existing.name}" already exists.`,
          category: existing,
        });
      }

      const newCategory = await Category.create({
        id: cleanId,
        name: cleanName,
      });

      // Keep memoryStore synchronized
      const memExisting = memoryStore.categories.find(
        (c) => c.id?.toLowerCase() === cleanId.toLowerCase()
      );
      if (!memExisting) {
        memoryStore.categories.push({
          id: cleanId,
          name: cleanName,
          _id: newCategory._id?.toString(),
        });
      }

      return res.status(201).json({
        success: true,
        message: `Category "${cleanName}" created successfully in database collection.`,
        category: newCategory,
      });
    }

    // In-memory fallback
    const memMatch = memoryStore.categories.find(
      (c) =>
        c.id?.toLowerCase() === cleanId.toLowerCase() ||
        c.name?.toLowerCase() === cleanName.toLowerCase()
    );

    if (memMatch) {
      return res.status(409).json({
        success: false,
        message: `Category "${memMatch.name}" already exists.`,
        category: memMatch,
      });
    }

    const fallbackCat = {
      _id: `cat_${Date.now()}`,
      id: cleanId,
      name: cleanName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryStore.categories.push(fallbackCat);

    return res.status(201).json({
      success: true,
      message: `Category "${cleanName}" created successfully.`,
      category: fallbackCat,
    });
  } catch (error) {
    console.error('Error in createCategory:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create category.',
      error: error.message,
    });
  }
};

// DELETE /api/categories/:id or DELETE /api/admin/categories/:id
const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Category identifier is required.' });
    }

    const cleanId = String(id).trim();

    // Check & remove from memoryStore as well
    const memIdx = memoryStore.categories.findIndex(
      (c) => c.id === cleanId || c._id === cleanId
    );
    let memRemoved = null;
    if (memIdx !== -1) {
      memRemoved = memoryStore.categories.splice(memIdx, 1)[0];
    }

    if (isMongoConnected()) {
      const deleted = await Category.findOneAndDelete({
        $or: [
          { id: cleanId },
          ...(mongoose.isValidObjectId(cleanId) ? [{ _id: cleanId }] : []),
        ],
      });

      if (!deleted && !memRemoved) {
        return res.status(404).json({ success: false, message: 'Category not found in database.' });
      }

      return res.status(200).json({
        success: true,
        message: `Category "${(deleted || memRemoved).name}" deleted successfully.`,
      });
    }

    if (memRemoved) {
      return res.status(200).json({
        success: true,
        message: `Category "${memRemoved.name}" deleted successfully.`,
      });
    }

    return res.status(404).json({ success: false, message: 'Category not found.' });
  } catch (error) {
    console.error('Error in deleteCategory:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete category.',
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
  createCategory,
  deleteCategory,
  getDeliveryCharges,
};


