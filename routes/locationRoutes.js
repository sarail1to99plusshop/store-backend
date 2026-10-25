const express = require('express');
const router = express.Router();
const {
  getDistricts,
  getDivisions,
  checkDeliveryEligibility,
} = require('../controllers/locationController');

router.get('/districts', getDistricts);
router.get('/divisions', getDivisions);
router.all('/check-eligibility', checkDeliveryEligibility);

module.exports = router;

