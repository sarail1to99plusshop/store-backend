const Review = require('../models/Review');
const Product = require('../models/Product');
const { isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');

// Helper to logically calculate average star rating, review count, and star breakdown from user reviews
const computeRatingStats = (reviewsList) => {
  const ratingBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

  if (!reviewsList || reviewsList.length === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingBreakdown,
    };
  }

  let totalScore = 0;
  let validCount = 0;

  reviewsList.forEach((rev) => {
    const rawRating = Number(rev.rating);
    if (!Number.isNaN(rawRating) && rawRating >= 1 && rawRating <= 5) {
      const roundedStar = Math.min(5, Math.max(1, Math.round(rawRating)));
      ratingBreakdown[roundedStar] = (ratingBreakdown[roundedStar] || 0) + 1;
      totalScore += rawRating;
      validCount += 1;
    }
  });

  if (validCount === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingBreakdown,
    };
  }

  const averageRating = Number((totalScore / validCount).toFixed(1));
  return {
    averageRating,
    totalReviews: validCount,
    ratingBreakdown,
  };
};

// GET /api/products/:id/reviews
const getProductReviews = async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (Number.isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid numeric productId is required.',
      });
    }

    if (isMongoConnected()) {
      const rawReviews = await Review.find({ productId })
        .sort({ createdAt: -1 })
        .lean();

      // Sanitize: never leak customer email addresses in public reviews API
      const reviews = rawReviews.map(({ userEmail, ...safeReview }) => safeReview);

      const { averageRating, totalReviews, ratingBreakdown } =
        computeRatingStats(reviews);

      return res.status(200).json({
        success: true,
        productId,
        averageRating,
        totalReviews,
        ratingBreakdown,
        reviews,
      });
    }

    const rawReviews = memoryStore.reviews
      .filter((r) => Number(r.productId) === productId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const reviews = rawReviews.map(({ userEmail, ...safeReview }) => safeReview);

    const { averageRating, totalReviews, ratingBreakdown } =
      computeRatingStats(reviews);

    return res.status(200).json({
      success: true,
      productId,
      averageRating,
      totalReviews,
      ratingBreakdown,
      reviews,
    });
  } catch (error) {
    console.error('Error in getProductReviews:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch product reviews.',
      error: error.message,
    });
  }
};

// POST /api/products/:id/reviews
// Adds a new user review and logically recalculates product star rating & review count
const addProductReview = async (req, res) => {
  try {
    const productId = Number(req.params.id || req.body.productId);
    const {
      name,
      rating,
      comment,
      userId = 'guest',
      userEmail = '',
      userPhoto = '',
    } = req.body;

    if (Number.isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid productId is required.',
      });
    }

    const parsedRating = Number(rating);
    if (Number.isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be a number between 1 and 5.',
      });
    }
    const numericRating = Math.min(5, Math.max(1, parsedRating));

    if (!name || !comment) {
      return res.status(400).json({
        success: false,
        message: 'Reviewer name and comment are required.',
      });
    }

    if (isMongoConnected()) {
      const newReview = await Review.create({
        productId,
        userId,
        userEmail,
        userPhoto,
        name: name.trim(),
        rating: numericRating,
        comment: comment.trim(),
        verifiedPurchase: true,
      });

      const allReviews = await Review.find({ productId }).lean();
      const { averageRating, totalReviews, ratingBreakdown } =
        computeRatingStats(allReviews);

      const updatedProduct = await Product.findOneAndUpdate(
        { id: productId },
        {
          $set: {
            rating: averageRating,
            reviews: totalReviews,
          },
        },
        { new: true }
      ).lean();

      // Sync fallback store
      const memProduct = memoryStore.products.find((p) => p.id === productId);
      if (memProduct) {
        memProduct.rating = averageRating;
        memProduct.reviews = totalReviews;
      }

      return res.status(201).json({
        success: true,
        message: 'Review added and product star rating calculated dynamically.',
        review: newReview,
        averageRating,
        totalReviews,
        ratingBreakdown,
        product: updatedProduct,
      });
    }

    // Fallback store when MongoDB is not connected
    const newReview = {
      _id: `rev_${Date.now()}`,
      productId,
      userId,
      userEmail,
      userPhoto,
      name: name.trim(),
      rating: numericRating,
      comment: comment.trim(),
      verifiedPurchase: true,
      createdAt: new Date().toISOString(),
    };

    memoryStore.reviews.unshift(newReview);

    const productReviews = memoryStore.reviews.filter(
      (r) => Number(r.productId) === productId
    );
    const { averageRating, totalReviews, ratingBreakdown } =
      computeRatingStats(productReviews);

    const targetProduct = memoryStore.products.find((p) => p.id === productId);
    if (targetProduct) {
      targetProduct.rating = averageRating;
      targetProduct.reviews = totalReviews;
    }

    return res.status(201).json({
      success: true,
      message: 'Review added and product star rating calculated dynamically.',
      review: newReview,
      averageRating,
      totalReviews,
      ratingBreakdown,
      product: targetProduct || null,
    });
  } catch (error) {
    console.error('Error in addProductReview:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit review.',
      error: error.message,
    });
  }
};

module.exports = {
  getProductReviews,
  addProductReview,
  computeRatingStats,
};
