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
 * Normalize district string to official canonical English name (e.g. 'Brahmanbaria', 'Dhaka').
 * Handles English, Bangla (বাংলা), case, and common aliases.
 * 
 * @param {string} district
 * @returns {string} - Canonical district name or trimmed original
 */
const normalizeDistrictName = (district) => {
  if (!district || typeof district !== 'string') return '';
  const clean = district.trim().toLowerCase();
  if (!clean) return '';

  // Direct alias checks
  if (
    clean === 'brahmanbaria' ||
    clean === 'b.baria' ||
    clean === 'b-baria' ||
    clean === 'bbaria' ||
    clean.includes('ব্রাহ্মণ') ||
    clean.includes('বাড়িয়া') ||
    clean.includes('বাড়িয়া')
  ) {
    return 'Brahmanbaria';
  }

  if (clean === 'dhaka' || clean.includes('ঢাকা')) {
    return 'Dhaka';
  }

  const cleanUnicode = clean.normalize('NFC');
  for (const d of BANGLADESH_DISTRICTS) {
    if (
      clean === d.name.toLowerCase() ||
      clean === d.bn.toLowerCase() ||
      cleanUnicode === d.name.toLowerCase().normalize('NFC') ||
      cleanUnicode === d.bn.toLowerCase().normalize('NFC')
    ) {
      return d.name;
    }
  }

  return district.trim();
};

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

  // If explicitly labeled as "outside", "without", or nationwide, it is not an inside local rate
  if (
    loc.includes('outside') ||
    loc.includes('without') ||
    loc.includes('আউটসাইড') ||
    loc.includes('বাইরে') ||
    loc.includes('ছাড়া') ||
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

  const canon = normalizeDistrictName(district).toLowerCase();
  const targetDistrict = getTargetDistrictForZone(zone);

  if (targetDistrict) {
    // This is a local "Inside [District]" zone (e.g. Inside Brahmanbaria or Inside Dhaka City).
    // It is ONLY valid if the customer's district matches the target district!
    return canon === targetDistrict.toLowerCase();
  }

  // If this zone is an outside / nationwide zone:
  // All upazilas/thanas in Brahmanbaria District use the district's local rate (R04).
  // The district selection alone determines this; outside zone is NOT applicable for Brahmanbaria.
  if (canon === 'brahmanbaria') {
    return false;
  }

  // For other districts, outside / nationwide zone is applicable.
  return true;
};

/**
 * Select the optimal, geographically-valid delivery zone for the customer's district and thana.
 * 
 * @param {Array} zones - Array of delivery charge objects
 * @param {string} district - Selected district
 * @param {string} [thana] - Selected thana/upazila (optional for granular matching)
 * @returns {object|null} - Best matching delivery zone
 */
const getBestMatchingDeliveryZone = (zones, district, thana = '') => {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  if (!district || typeof district !== 'string' || !district.trim()) {
    return zones.find((z) => z.isDefault && z.isActive !== false) || zones[0];
  }

  const canon = normalizeDistrictName(district).toLowerCase();
  const normalizedThana = (thana || '').trim().toLowerCase();

  const applicable = zones.filter(
    (z) => z.isActive !== false && isZoneApplicableForDistrict(z, district, zones)
  );

  if (applicable.length === 0) {
    return zones.find((z) => z.isDefault && z.isActive !== false) || zones[0];
  }

  // 1. Brahmanbaria District:
  // All upazilas/thanas in Brahmanbaria District use the district's local rate (initially ৳60).
  // District selection alone determines this; thana text NEVER alters the fee.
  if (canon === 'brahmanbaria') {
    const bbMatch =
      applicable.find((z) => getTargetDistrictForZone(z)?.toLowerCase() === 'brahmanbaria') ||
      applicable.find((z) => z.id === 'inside-brahmanbaria') ||
      applicable.find((z) => {
        const loc = (z.location || '').toLowerCase();
        return loc.includes('brahmanbaria') || loc.includes('ব্রাহ্মণবাড়িয়া');
      }) ||
      applicable.find((z) => z.charge === 60);

    if (bbMatch) return bbMatch;
    return applicable[0];
  }

  // 2. Dhaka District:
  if (canon === 'dhaka') {
    const isOutsideDhakaThana = [
      'dhamrai', 'dohar', 'nawabganj', 'কেরানীগঞ্জ', 'ধামরাই', 'দোহার', 'নবাবগঞ্জ'
    ].some((t) => normalizedThana.includes(t));

    if (isOutsideDhakaThana) {
      const withoutDhakaMatch = applicable.find(
        (z) => z.charge === 130 || z.id?.includes('without') || z.id?.includes('outside')
      );
      if (withoutDhakaMatch) return withoutDhakaMatch;
    }

    const dhakaMatch = applicable.find(
      (z) =>
        getTargetDistrictForZone(z)?.toLowerCase() === 'dhaka' ||
        z.id === 'inside-dhaka' ||
        z.charge === 120
    );
    if (dhakaMatch) return dhakaMatch;
  }

  // 3. For all other districts (Rest of Bangladesh):
  const outsideMatch = applicable.find((z) => {
    const loc = (z.location || '').toLowerCase();
    const id = (z.id || '').toLowerCase();
    return (
      loc.includes('without') ||
      loc.includes('outside') ||
      loc.includes('rest of') ||
      loc.includes('আউটসাইড') ||
      id.includes('without') ||
      id.includes('outside') ||
      z.charge === 130
    );
  });
  if (outsideMatch) return outsideMatch;

  // Fallback to default applicable or first applicable zone
  const defaultApplicable = applicable.find((z) => z.isDefault);
  if (defaultApplicable) return defaultApplicable;

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

  const isValid = isZoneApplicableForDistrict(zone, district, allZones);
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
  normalizeDistrictName,
  getTargetDistrictForZone,
  isZoneApplicableForDistrict,
  getBestMatchingDeliveryZone,
  validateDeliveryEligibility,
};

