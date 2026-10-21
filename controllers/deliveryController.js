const mongoose = require('mongoose');
const DeliveryCharge = require('../models/DeliveryCharge');
const { isMongoConnected } = require('../config/db');
const { memoryStore, initialDeliveryCharges } = require('../data/seedData');

/**
 * Helper to ensure DeliveryCharge collection is initialized with defaults if empty
 */
const ensureDeliveryChargesSeeded = async () => {
  if (!isMongoConnected()) return;
  try {
    const count = await DeliveryCharge.countDocuments();
    if (count === 0) {
      await DeliveryCharge.insertMany(
        initialDeliveryCharges.map((d) => ({
          ...d,
          isActive: true,
        }))
      );
      console.log('[deliveryController] Seeded initial delivery charges into MongoDB.');
    }
  } catch (err) {
    console.error('[deliveryController] Seeding error:', err.message);
  }
};

/**
 * GET /api/delivery-charges
 * Public endpoint used by storefront checkout to fetch active delivery zones & rates
 */
const getDeliveryCharges = async (req, res) => {
  try {
    if (isMongoConnected()) {
      await ensureDeliveryChargesSeeded();
      const charges = await DeliveryCharge.find({ isActive: { $ne: false } })
        .sort({ isDefault: -1, createdAt: 1 })
        .lean();

      if (charges && charges.length > 0) {
        // Keep memoryStore in sync
        memoryStore.deliveryCharges = charges.map((c) => ({
          id: c.id,
          location: c.location,
          charge: c.charge,
          estimatedDays: c.estimatedDays,
          isDefault: c.isDefault,
          isActive: c.isActive,
        }));

        return res.status(200).json({
          success: true,
          deliveryCharges: charges,
        });
      }
    }

    const activeMemCharges = (memoryStore.deliveryCharges || initialDeliveryCharges).filter(
      (d) => d.isActive !== false
    );

    return res.status(200).json({
      success: true,
      deliveryCharges: activeMemCharges,
    });
  } catch (error) {
    console.error('Error in getDeliveryCharges:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery charges.',
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/delivery-charges
 * Admin endpoint: returns all delivery zones (including inactive ones)
 */
const getAllDeliveryChargesAdmin = async (req, res) => {
  try {
    if (isMongoConnected()) {
      await ensureDeliveryChargesSeeded();
      const charges = await DeliveryCharge.find().sort({ isDefault: -1, createdAt: 1 }).lean();
      return res.status(200).json({
        success: true,
        deliveryCharges: charges,
      });
    }

    return res.status(200).json({
      success: true,
      deliveryCharges: memoryStore.deliveryCharges || initialDeliveryCharges,
    });
  } catch (error) {
    console.error('Error in getAllDeliveryChargesAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery charges for admin.',
      error: error.message,
    });
  }
};

/**
 * POST /api/admin/delivery-charges
 * Admin endpoint: Add a new delivery location zone
 */
const createDeliveryChargeAdmin = async (req, res) => {
  try {
    const { location, charge, estimatedDays, isDefault, isActive = true } = req.body;

    if (!location || charge === undefined || charge === null) {
      return res.status(400).json({
        success: false,
        message: 'Location name and delivery charge fee are required.',
      });
    }

    const numericCharge = Math.max(0, Number(charge));
    const generatedId = (
      req.body.id ||
      location
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') ||
      `zone-${Date.now()}`
    ).trim();

    if (isMongoConnected()) {
      const existing = await DeliveryCharge.findOne({
        $or: [{ id: generatedId }, { location: { $regex: new RegExp(`^${location.trim()}$`, 'i') } }],
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Delivery zone "${location}" already exists.`,
        });
      }

      if (isDefault) {
        await DeliveryCharge.updateMany({}, { isDefault: false });
      }

      const created = await DeliveryCharge.create({
        id: generatedId,
        location: location.trim(),
        charge: numericCharge,
        estimatedDays: (estimatedDays || '1-3 Business Days').trim(),
        isDefault: Boolean(isDefault),
        isActive: Boolean(isActive),
      });

      // Sync memoryStore
      if (isDefault && Array.isArray(memoryStore.deliveryCharges)) {
        memoryStore.deliveryCharges.forEach((d) => (d.isDefault = false));
      }
      memoryStore.deliveryCharges.push(created.toObject());

      return res.status(201).json({
        success: true,
        message: `Delivery zone "${created.location}" (৳${created.charge}) created successfully.`,
        deliveryCharge: created,
      });
    }

    // Memory Store branch
    const memExisting = memoryStore.deliveryCharges.find(
      (d) => d.id === generatedId || d.location?.toLowerCase() === location.trim().toLowerCase()
    );
    if (memExisting) {
      return res.status(409).json({
        success: false,
        message: `Delivery zone "${location}" already exists.`,
      });
    }

    if (isDefault) {
      memoryStore.deliveryCharges.forEach((d) => (d.isDefault = false));
    }

    const newZone = {
      id: generatedId,
      location: location.trim(),
      charge: numericCharge,
      estimatedDays: (estimatedDays || '1-3 Business Days').trim(),
      isDefault: Boolean(isDefault),
      isActive: Boolean(isActive),
    };
    memoryStore.deliveryCharges.push(newZone);

    return res.status(201).json({
      success: true,
      message: `Delivery zone "${newZone.location}" (৳${newZone.charge}) created successfully.`,
      deliveryCharge: newZone,
    });
  } catch (error) {
    console.error('Error in createDeliveryChargeAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create delivery zone.',
      error: error.message,
    });
  }
};

/**
 * PUT/PATCH /api/admin/delivery-charges/:id
 * Admin endpoint: Update an existing delivery zone (e.g. Inside Dhaka or Outside Dhaka fee)
 */
const updateDeliveryChargeAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { location, charge, estimatedDays, isDefault, isActive } = req.body;

    const lookupQuery = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { id }] } : { id };

    if (isMongoConnected()) {
      const existing = await DeliveryCharge.findOne(lookupQuery);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: `Delivery zone "${id}" not found.`,
        });
      }

      if (isDefault) {
        await DeliveryCharge.updateMany({ _id: { $ne: existing._id } }, { isDefault: false });
      }

      if (location !== undefined) existing.location = location.trim();
      if (charge !== undefined) existing.charge = Math.max(0, Number(charge));
      if (estimatedDays !== undefined) existing.estimatedDays = estimatedDays.trim();
      if (isDefault !== undefined) existing.isDefault = Boolean(isDefault);
      if (isActive !== undefined) existing.isActive = Boolean(isActive);

      await existing.save();

      // Sync memoryStore
      const memIdx = memoryStore.deliveryCharges.findIndex(
        (d) => d.id === existing.id || String(d._id) === String(existing._id)
      );
      if (memIdx !== -1) {
        if (isDefault) {
          memoryStore.deliveryCharges.forEach((d) => (d.isDefault = false));
        }
        memoryStore.deliveryCharges[memIdx] = existing.toObject();
      }

      return res.status(200).json({
        success: true,
        message: `Delivery zone "${existing.location}" updated to ৳${existing.charge}.`,
        deliveryCharge: existing,
      });
    }

    // Memory Store branch
    const memIdx = memoryStore.deliveryCharges.findIndex(
      (d) => d.id?.toLowerCase() === id.toLowerCase() || String(d._id) === id
    );
    if (memIdx === -1) {
      return res.status(404).json({
        success: false,
        message: `Delivery zone "${id}" not found.`,
      });
    }

    if (isDefault) {
      memoryStore.deliveryCharges.forEach((d) => (d.isDefault = false));
    }

    const current = memoryStore.deliveryCharges[memIdx];
    if (location !== undefined) current.location = location.trim();
    if (charge !== undefined) current.charge = Math.max(0, Number(charge));
    if (estimatedDays !== undefined) current.estimatedDays = estimatedDays.trim();
    if (isDefault !== undefined) current.isDefault = Boolean(isDefault);
    if (isActive !== undefined) current.isActive = Boolean(isActive);

    return res.status(200).json({
      success: true,
      message: `Delivery zone "${current.location}" updated to ৳${current.charge}.`,
      deliveryCharge: current,
    });
  } catch (error) {
    console.error('Error in updateDeliveryChargeAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update delivery zone.',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/admin/delivery-charges/:id
 * Admin endpoint: Delete a delivery zone (with safety guard against deleting all zones)
 */
const deleteDeliveryChargeAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const lookupQuery = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { id }] } : { id };

    if (isMongoConnected()) {
      const total = await DeliveryCharge.countDocuments();
      if (total <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the only remaining delivery zone. At least one zone must exist.',
        });
      }

      const deleted = await DeliveryCharge.findOneAndDelete(lookupQuery);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: `Delivery zone "${id}" not found.`,
        });
      }

      memoryStore.deliveryCharges = memoryStore.deliveryCharges.filter(
        (d) => d.id !== deleted.id && String(d._id) !== String(deleted._id)
      );

      return res.status(200).json({
        success: true,
        message: `Delivery zone "${deleted.location}" deleted successfully.`,
      });
    }

    if (memoryStore.deliveryCharges.length <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the only remaining delivery zone. At least one zone must exist.',
      });
    }

    const initialLen = memoryStore.deliveryCharges.length;
    memoryStore.deliveryCharges = memoryStore.deliveryCharges.filter(
      (d) => d.id?.toLowerCase() !== id.toLowerCase() && String(d._id) !== id
    );

    if (memoryStore.deliveryCharges.length === initialLen) {
      return res.status(404).json({
        success: false,
        message: `Delivery zone "${id}" not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Delivery zone deleted successfully.`,
    });
  } catch (error) {
    console.error('Error in deleteDeliveryChargeAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete delivery zone.',
      error: error.message,
    });
  }
};

module.exports = {
  getDeliveryCharges,
  getAllDeliveryChargesAdmin,
  createDeliveryChargeAdmin,
  updateDeliveryChargeAdmin,
  deleteDeliveryChargeAdmin,
};

