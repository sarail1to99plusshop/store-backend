/**
 * Delivery Zone Matching & Restriction Engine for Bangladesh E-Commerce
 * 
 * Enforces strict geographic compatibility between customer delivery location
 * (Division & District) and merchant delivery fee zones.
 * 
 * Prevents errors such as selecting "Inside Brahmanbaria" when the customer
 * resides in Narsingdi (Dhaka Division) or "Inside Dhaka" when residing in Narsingdi.
 */

const { BANGLADESH_DISTRICTS } = require('../data/bangladeshDistricts');

/**
 * Detect if a delivery zone is an "inside / local" rate restricted to a specific district.
 * 
 * @param {object} zone - Delivery zone object { id, location, charge }
 * @returns {string|null} - Target district name (e.g. 'Brahmanbaria', 'Dhaka') or null if nationwide/outside
 */
const getTargetDistrictForZone = (zone) => {
  if (!zone) return null;
  const loc = (zone.location || '').toLowerCase();
  const id = (zone.id || '').toLowerCase();

  // If explicitly labeled as "outside" or nationwide, it is not an inside local rate
  if (
    loc.includes('outside') ||
    loc.includes('আউটসাইড') ||
    loc.includes('সারা দেশ') ||
    loc.includes('সারাদেশ') ||
    loc.includes('all bangladesh') ||
    loc.includes('whole bangladesh') ||
    loc.includes('nationwide')
  ) {
    return null;
  }

  // Check for inside or city indicator
  const hasInsideIndicator =
    loc.includes('inside') ||
    loc.includes('ইনসাইড') ||
    loc.includes('city') ||
    loc.includes('সিটি') ||
    loc.includes('local') ||
    loc.includes('লোকাল') ||
    id.includes('inside');

  if (!hasInsideIndicator) {
    // If not explicitly "inside", check if the location literally matches only a single district
    for (const d of BANGLADESH_DISTRICTS) {
      if (loc === d.name.toLowerCase() || loc === d.bn) {
        return d.name;
      }
    }
    return null;
  }

  // Match specific district in location string first
  if (loc.includes('brahmanbaria') || loc.includes('ব্রাহ্মণবাড়িয়া')) return 'Brahmanbaria';
  if (loc.includes('dhaka') || loc.includes('ঢাকা')) return 'Dhaka';
  if (loc.includes('chattogram') || loc.includes('chittagong') || loc.includes('চট্টগ্রাম')) return 'Chattogram';
  if (loc.includes('sylhet') || loc.includes('সিলেট')) return 'Sylhet';

  for (const d of BANGLADESH_DISTRICTS) {
    if (loc.includes(d.name.toLowerCase()) || loc.includes(d.bn)) {
      return d.name;
    }
  }

  // Fallback to id inspection if location string didn't specify district name
  if (id.includes('brahmanbaria')) return 'Brahmanbaria';
  if (id.includes('dhaka') && !id.includes('outside')) return 'Dhaka';

  return null;
};

/**
 * Determine if a delivery zone is geographically valid for a customer's district.
 * 
 * @param {object} zone - Delivery zone object { id, location, charge }
 * @param {string} district - Selected district name (e.g. 'Narsingdi', 'Brahmanbaria')
 * @param {Array} allZones - Optional array of all active delivery zones
 * @returns {boolean} - true if valid, false if incompatible
 */
const isZoneApplicableForDistrict = (zone, district, allZones = []) => {
  if (!zone) return false;
  if (!district || typeof district !== 'string' || !district.trim()) {
    // District not selected yet — allow until customer chooses district
    return true;
  }

  const normalizedDistrict = district.trim().toLowerCase();
  const targetDistrict = getTargetDistrictForZone(zone);

  if (targetDistrict) {
    // This is a local "Inside [District]" zone.
    // It is ONLY valid if the customer's district exactly matches the target district!
    return normalizedDistrict === targetDistrict.toLowerCase();
  }

  // This is an "outside / non-local" zone.
  const loc = (zone.location || '').toLowerCase();
  if (loc.includes('outside') || loc.includes('আউটসাইড')) {
    // If the customer district has a dedicated inside zone among available zones (e.g. Inside dhaka),
    // then the general outside zone is not applicable for this district.
    if (Array.isArray(allZones) && allZones.length > 0) {
      const hasDedicatedInsideZone = allZones.some(
        (z) => z.isActive !== false && getTargetDistrictForZone(z)?.toLowerCase() === normalizedDistrict
      );
      if (hasDedicatedInsideZone) {
        return false;
      }
    }

    if (loc.includes('brahmanbaria') || loc.includes('ব্রাহ্মণবাড়িয়া')) {
      // "Outside Brahmanbaria" is valid for all districts EXCEPT Brahmanbaria itself!
      return normalizedDistrict !== 'brahmanbaria';
    }
    if (loc.includes('dhaka') || loc.includes('ঢাকা')) {
      // "Outside Dhaka" is valid for all districts EXCEPT Dhaka city/district itself!
      return normalizedDistrict !== 'dhaka';
    }
  }

  // Standard nationwide rate applies everywhere
  return true;
};

/**
 * Select the optimal, geographically-valid delivery zone for the customer's district.
 * 
 * @param {Array} zones - Array of delivery charge objects
 * @param {string} district - Selected district
 * @returns {object|null} - Best matching delivery zone
 */
const getBestMatchingDeliveryZone = (zones, district) => {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  if (!district || typeof district !== 'string' || !district.trim()) {
    return zones.find((z) => z.isDefault && z.isActive !== false) || zones[0];
  }

  const applicable = zones.filter(
    (z) => z.isActive !== false && isZoneApplicableForDistrict(z, district, zones)
  );

  if (applicable.length === 0) {
    return zones.find((z) => z.isDefault && z.isActive !== false) || zones[0];
  }

  // If customer is in a local district (e.g. Brahmanbaria or Dhaka), prioritize the local inside zone
  const localMatch = applicable.find(
    (z) => getTargetDistrictForZone(z)?.toLowerCase() === district.trim().toLowerCase()
  );
  if (localMatch) return localMatch;

  // Otherwise, return the applicable zone (prioritizing default or outside)
  const defaultApplicable = applicable.find((z) => z.isDefault);
  if (defaultApplicable) return defaultApplicable;

  const outsideZone = applicable.find((z) => {
    const loc = (z.location || '').toLowerCase();
    return loc.includes('outside') || loc.includes('আউটসাইড');
  });
  if (outsideZone) return outsideZone;

  return applicable[0];
};

/**
 * Validate customer selection and return detailed eligibility rationale.
 * 
 * @param {object} zone - Selected zone
 * @param {string} district - Customer district
 * @param {Array} allZones - Available zones
 * @returns {{ valid: boolean, message?: string, recommendedZone?: object }}
 */
const validateDeliveryEligibility = (zone, district, allZones = []) => {
  if (!zone) {
    return { valid: false, message: 'ডেলিভারি এরিয়া নির্বাচন করুন (Select delivery area).' };
  }
  if (!district) {
    return { valid: true };
  }

  const isValid = isZoneApplicableForDistrict(zone, district);
  if (isValid) {
    return { valid: true };
  }

  const recommendedZone = getBestMatchingDeliveryZone(allZones, district);
  const targetDistrict = getTargetDistrictForZone(zone);

  let message = `আপনার নির্বাচিত জেলা ${district}। "${zone.location}" চার্জটি আপনার জেলার জন্য প্রযোজ্য নয়।`;
  if (targetDistrict) {
    message += ` এটি শুধুমাত্র ${targetDistrict} জেলার জন্য প্রযোজ্য।`;
  }
  if (recommendedZone) {
    message += ` আপনার জন্য সঠিক ডেলিভারি জোন: "${recommendedZone.location}" (৳${recommendedZone.charge})।`;
  }

  return {
    valid: false,
    message,
    recommendedZone,
  };
};

module.exports = {
  getTargetDistrictForZone,
  isZoneApplicableForDistrict,
  getBestMatchingDeliveryZone,
  validateDeliveryEligibility,
};

