const express = require('express');
const router = express.Router();
const {
  getCategories,
  createCategory,
  deleteCategory,
  getDeliveryCharges,
} = require('../controllers/categoryController');

router.get('/', getCategories);
router.post('/', createCategory);
router.delete('/:id', deleteCategory);
router.get('/delivery-charges', getDeliveryCharges);

module.exports = router;


