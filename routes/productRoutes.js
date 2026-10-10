const express = require('express');
const router = express.Router();
const { getProducts, getProductById } = require('../controllers/productController');
const {
  getProductReviews,
  addProductReview,
} = require('../controllers/reviewController');

router.get('/', getProducts);
router.get('/:id', getProductById);
router.get('/:id/reviews', getProductReviews);
router.post('/:id/reviews', addProductReview);

module.exports = router;

