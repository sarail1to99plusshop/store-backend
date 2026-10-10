const express = require('express');
const router = express.Router();
const {
  getCategories,
  getDeliveryCharges,
} = require('../controllers/categoryController');

router.get('/', getCategories);
router.get('/delivery-charges', getDeliveryCharges);

module.exports = router;

