const mongoose = require('mongoose');
const District = require('../models/District');
const DeliveryCharge = require('../models/DeliveryCharge');
const { isMongoConnected } = require('../config/db');
const {
  BANGLADESH_DIVISIONS,
  BANGLADESH_DISTRICTS,
} = require('../data/bangladeshDistricts');
const {
  isZoneApplicableForDistrict,
  getBestMatchingDeliveryZone,
  validateDeliveryEligibility,
} = require('../utils/deliveryZoneRules');
const { memoryStore } = require('../data/seedData');

/**
 * Get all active districts of Bangladesh for storefront checkout
 * GET /api/locations/districts?division=Dhaka
 * GET /api/districts?division=Dhaka
 */
const getDistricts = async (req, res) => {
  try {
    const { division, activeOnly } = req.query;
    const filter = {};

    // Only filter to active districts when explicitly requested with activeOnly=true.
    // By default, all 64 districts are returned with their isActive status so customers
    // can see that disabled districts are visibly marked as "Delivery Not Available".
    if (activeOnly === 'true') {
      filter.isActive = { $ne: false };
    }

    if (division && typeof division === 'string') {
      // Case-insensitive match on division
      filter.division = new RegExp(`^${division.trim()}$`, 'i');
    }

    let districts = [];

    if (isMongoConnected()) {
      try {
        districts = await District.find(filter)
          .sort({ order: 1, name: 1 })
          .select('-__v')
          .lean();
      } catch (dbErr) {
        console.warn('[locationController] MongoDB read error, falling back to memory/seed:', dbErr.message);
      }
    }

    if (!districts || districts.length === 0) {
      const sourceList = Array.isArray(memoryStore.districts) && memoryStore.districts.length > 0
        ? memoryStore.districts
        : BANGLADESH_DISTRICTS;

      districts = sourceList.filter((d) => {
        if (activeOnly === 'true' && d.isActive === false) return false;
        if (!division) return true;
        return d.division.toLowerCase() === division.trim().toLowerCase();
      });
    }

    return res.status(200).json({
      success: true,
      count: districts.length,
      districts,
    });
  } catch (err) {
    console.error('[locationController] getDistricts error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve Bangladesh districts.',
      error: err.message,
    });
  }
};

/**
 * Get all 8 administrative divisions of Bangladesh
 * GET /api/locations/divisions
 */
const getDivisions = (req, res) => {
  return res.status(200).json({
    success: true,
    count: BANGLADESH_DIVISIONS.length,
    divisions: BANGLADESH_DIVISIONS,
  });
};

/**
 * Check delivery fee eligibility for a given district
 * GET /api/locations/check-eligibility?district=Narsingdi&deliveryLocation=Inside%20brahmanbaria
 */
const checkDeliveryEligibility = async (req, res) => {
  try {
    const district = (req.query.district || req.body?.district || '').trim();
    const deliveryLocation = (req.query.deliveryLocation || req.body?.deliveryLocation || '').trim();

    let charges = [];
    if (isMongoConnected()) {
      try {
        charges = await DeliveryCharge.find({ isActive: { $ne: false } }).lean();
      } catch (err) {
        console.warn('[locationController] Failed to query delivery charges:', err.message);
      }
    }
    if (!charges || charges.length === 0) {
      charges = memoryStore.deliveryCharges || [];
    }

    // Determine candidate zone
    const candidateZone = charges.find(
      (c) =>
        c.location?.toLowerCase() === deliveryLocation.toLowerCase() ||
        c.id?.toLowerCase() === deliveryLocation.toLowerCase()
    );

    const evaluation = validateDeliveryEligibility(candidateZone, district, charges);
    const recommendedZone = getBestMatchingDeliveryZone(charges, district);

    const applicableCharges = charges.map((c) => ({
      ...c,
      isApplicable: isZoneApplicableForDistrict(c, district, charges),
    }));

    return res.status(200).json({
      success: true,
      district,
      candidateDeliveryLocation: deliveryLocation,
      valid: evaluation.valid,
      message: evaluation.message || 'Delivery zone is valid for the specified district.',
      recommendedZone,
      applicableCharges,
    });
  } catch (err) {
    console.error('[locationController] checkDeliveryEligibility error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to evaluate delivery charge eligibility.',
      error: err.message,
    });
  }
};

/**
 * GET /api/admin/districts
 * Admin endpoint: List all 64 districts with division filters, search & active/disabled counts
 */
const getAllDistrictsAdmin = async (req, res) => {
  try {
    const { division, search, status } = req.query;
    const filter = {};

    if (division && typeof division === 'string' && division.trim()) {
      filter.division = new RegExp(`^${division.trim()}$`, 'i');
    }

    if (status === 'active') {
      filter.isActive = { $ne: false };
    } else if (status === 'disabled' || status === 'inactive') {
      filter.isActive = false;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim();
      filter.$or = [
        { name: new RegExp(s, 'i') },
        { bn: new RegExp(s, 'i') },
        { division: new RegExp(s, 'i') },
      ];
    }

    let districts = [];
    if (isMongoConnected()) {
      try {
        districts = await District.find(filter)
          .sort({ order: 1, name: 1 })
          .select('-__v')
          .lean();
      } catch (dbErr) {
        console.warn('[locationController] Admin districts query fallback:', dbErr.message);
      }
    }

    if (!districts || districts.length === 0) {
      const sourceList = Array.isArray(memoryStore.districts) && memoryStore.districts.length > 0
        ? memoryStore.districts
        : BANGLADESH_DISTRICTS;

      districts = sourceList.filter((d) => {
        if (division && d.division.toLowerCase() !== division.trim().toLowerCase()) return false;
        if (status === 'active' && d.isActive === false) return false;
        if ((status === 'disabled' || status === 'inactive') && d.isActive !== false) return false;
        if (search) {
          const s = search.trim().toLowerCase();
          return (
            d.name.toLowerCase().includes(s) ||
            d.bn.includes(s) ||
            d.division.toLowerCase().includes(s)
          );
        }
        return true;
      });
    }

    // Count overall totals
    let allDistricts = [];
    if (isMongoConnected()) {
      try {
        allDistricts = await District.find({}).select('isActive').lean();
      } catch {
        allDistricts = memoryStore.districts || BANGLADESH_DISTRICTS;
      }
    } else {
      allDistricts = memoryStore.districts || BANGLADESH_DISTRICTS;
    }

    const totalActive = allDistricts.filter((d) => d.isActive !== false).length;
    const totalDisabled = allDistricts.filter((d) => d.isActive === false).length;

    return res.status(200).json({
      success: true,
      count: districts.length,
      totalCount: allDistricts.length,
      totalActive,
      totalDisabled,
      districts,
    });
  } catch (err) {
    console.error('[locationController] getAllDistrictsAdmin error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve admin districts.',
      error: err.message,
    });
  }
};

/**
 * PATCH /api/admin/districts/:id/status
 * Admin endpoint: Enable or disable a district (e.g. { isActive: false })
 */
const updateDistrictStatusAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isActive boolean value is required.',
      });
    }

    const newStatus = Boolean(isActive);
    const query = mongoose.isValidObjectId(id)
      ? { $or: [{ _id: id }, { name: new RegExp(`^${id.trim()}$`, 'i') }] }
      : { name: new RegExp(`^${id.trim()}$`, 'i') };

    let updated = null;

    if (isMongoConnected()) {
      try {
        updated = await District.findOneAndUpdate(
          query,
          { $set: { isActive: newStatus } },
          { new: true }
        ).lean();
      } catch (dbErr) {
        console.warn('[locationController] MongoDB updateDistrictStatus error:', dbErr.message);
      }
    }

    // Sync memoryStore
    if (Array.isArray(memoryStore.districts)) {
      const memIdx = memoryStore.districts.findIndex(
        (d) =>
          d.name.toLowerCase() === id.trim().toLowerCase() ||
          d._id?.toString() === id
      );
      if (memIdx !== -1) {
        memoryStore.districts[memIdx].isActive = newStatus;
        if (!updated) updated = memoryStore.districts[memIdx];
      }
    }

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: `District "${id}" not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: `District "${updated.name}" (${updated.bn}) has been ${newStatus ? 'enabled' : 'disabled'}.`,
      district: updated,
    });
  } catch (err) {
    console.error('[locationController] updateDistrictStatusAdmin error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update district status.',
      error: err.message,
    });
  }
};

module.exports = {
  getDistricts,
  getDivisions,
  checkDeliveryEligibility,
  getAllDistrictsAdmin,
  updateDistrictStatusAdmin,
};
