const express = require('express');
const router = express.Router();
const {
  getProductReviews,
  addProductReview,
} = require('../controllers/reviewController');

router.get('/:id', getProductReviews);
router.post('/', addProductReview);
router.post('/:id', addProductReview);

module.exports = router;

