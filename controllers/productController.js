const mongoose = require('mongoose');
const Product = require('../models/Product');
const Review = require('../models/Review');
const { isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');
const { computeRatingStats } = require('./reviewController');

// GET /api/products
// Supports pagination (default 10 products per page), category, tag, search, and sorting
// Dynamically calculates rating & review count for each product from actual user reviews
const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      category = 'all',
      tag = 'all',
      collection = 'all',
      search = '',
      sort = 'featured',
      all = 'false',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const fetchAll = all === 'true' || req.query.limit === 'all';

    let rawProducts = [];
    let allAvailableTags = [];

    const normalizeCollections = (p) => {
      const existing = p.collections || {};
      const tagLower = (p.tag || '').toLowerCase();
      return {
        bestSelling:
          existing.bestSelling !== undefined
            ? Boolean(existing.bestSelling)
            : Boolean(tagLower.includes('best') || tagLower.includes('top')),
        newArrival:
          existing.newArrival !== undefined
            ? Boolean(existing.newArrival)
            : Boolean(tagLower.includes('trending') || tagLower.includes('essential') || tagLower.includes('new')),
        hotOffer:
          existing.hotOffer !== undefined
            ? Boolean(existing.hotOffer)
            : Boolean(p.discount || tagLower.includes('hot') || tagLower.includes('deal')),
        popular:
          existing.popular !== undefined
            ? Boolean(existing.popular)
            : Boolean(tagLower.includes('popular')),
      };
    };

    if (isMongoConnected()) {
      const [dbProducts, reviewAgg] = await Promise.all([
        Product.find().sort({ id: 1 }).lean(),
        Review.aggregate([
          {
            $group: {
              _id: '$productId',
              totalReviews: { $sum: 1 },
              avgRating: { $avg: '$rating' },
            },
          },
        ]),
      ]);

      const statsMap = new Map();
      reviewAgg.forEach((item) => {
        const count = Number(item.totalReviews) || 0;
        const avg = count > 0 ? Number(Number(item.avgRating || 0).toFixed(1)) : 0;
        statsMap.set(Number(item._id), {
          rating: avg,
          reviews: count,
        });
      });

      rawProducts = dbProducts.map((p) => {
        const stats = statsMap.get(Number(p.id)) || { rating: 0, reviews: 0 };
        return {
          ...p,
          collections: normalizeCollections(p),
          rating: stats.rating,
          reviews: stats.reviews,
        };
      });
    } else {
      rawProducts = memoryStore.products.map((p) => {
        const prodReviews = memoryStore.reviews.filter(
          (r) => Number(r.productId) === Number(p.id)
        );
        const { averageRating, totalReviews } = computeRatingStats(prodReviews);
        return {
          ...p,
          collections: normalizeCollections(p),
          rating: averageRating,
          reviews: totalReviews,
        };
      });
    }

    // Collect unique tags across all products
    const tagSet = new Set();
    rawProducts.forEach((p) => {
      if (p.tag) tagSet.add(p.tag);
    });
    allAvailableTags = Array.from(tagSet);

    // Filter products
    const normalizedCat = category.toLowerCase().replace(/[\s&]+/g, '-');
    const normalizedTag = tag.toLowerCase().trim();
    const normalizedCol = collection.toLowerCase().trim();
    const normalizedSearch = search.toLowerCase().trim();

    let filtered = rawProducts.filter((product) => {
      const prodCat = (product.category || '').toLowerCase().replace(/[\s&]+/g, '-');
      const matchesCategory =
        category === 'all' ||
        !category ||
        product.category === category ||
        prodCat === normalizedCat;

      const matchesTag =
        tag === 'all' ||
        !tag ||
        (product.tag && product.tag.toLowerCase() === normalizedTag);

      const pCols = product.collections || {};
      const matchesCollection =
        normalizedCol === 'all' ||
        !normalizedCol ||
        (normalizedCol === 'bestselling' && pCols.bestSelling) ||
        (normalizedCol === 'newarrival' && pCols.newArrival) ||
        (normalizedCol === 'hotoffer' && pCols.hotOffer) ||
        (normalizedCol === 'popular' && pCols.popular);

      const matchesSearch =
        !normalizedSearch ||
        (product.name && product.name.toLowerCase().includes(normalizedSearch)) ||
        (product.category && product.category.toLowerCase().includes(normalizedSearch)) ||
        (product.tag && product.tag.toLowerCase().includes(normalizedSearch)) ||
        (product.description && product.description.toLowerCase().includes(normalizedSearch));

      return matchesCategory && matchesTag && matchesCollection && matchesSearch;
    });

    // Sorting
    if (sort === 'price-low') {
      filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sort === 'price-high') {
      filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else if (sort === 'rating') {
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sort === 'newest') {
      filtered.sort((a, b) => (b.id || 0) - (a.id || 0));
    } else {
      filtered.sort((a, b) => (a.id || 0) - (b.id || 0));
    }

    const totalProducts = filtered.length;

    if (fetchAll) {
      return res.status(200).json({
        success: true,
        products: filtered,
        tags: allAvailableTags,
        pagination: {
          totalProducts,
          totalPages: 1,
          currentPage: 1,
          limit: totalProducts,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    }

    const totalPages = Math.max(1, Math.ceil(totalProducts / limitNum));
    const safePage = Math.min(pageNum, totalPages);
    const startIndex = (safePage - 1) * limitNum;
    const paginatedProducts = filtered.slice(startIndex, startIndex + limitNum);

    return res.status(200).json({
      success: true,
      products: paginatedProducts,
      tags: allAvailableTags,
      pagination: {
        totalProducts,
        totalPages,
        currentPage: safePage,
        limit: limitNum,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      },
    });
  } catch (error) {
    console.error('Error in getProducts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch products.',
      error: error.message,
    });
  }
};

// GET /api/products/:id
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);

    if (isMongoConnected()) {
      let product = null;
      if (!Number.isNaN(numericId)) {
        product = await Product.findOne({ id: numericId }).lean();
      }
      if (!product && mongoose.Types.ObjectId.isValid(id)) {
        product = await Product.findById(id).lean();
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found.',
        });
      }

      // Dynamically compute rating & review count from actual reviews in MongoDB
      const prodReviews = await Review.find({ productId: Number(product.id) }).lean();
      const { averageRating, totalReviews } = computeRatingStats(prodReviews);
      product.rating = averageRating;
      product.reviews = totalReviews;

      return res.status(200).json({
        success: true,
        product,
      });
    }

    const product = memoryStore.products.find(
      (p) =>
        p.id === numericId ||
        p.id?.toString() === id?.toString() ||
        p._id?.$oid === id?.toString()
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    const prodReviews = memoryStore.reviews.filter(
      (r) => Number(r.productId) === Number(product.id)
    );
    const { averageRating, totalReviews } = computeRatingStats(prodReviews);

    return res.status(200).json({
      success: true,
      product: {
        ...product,
        rating: averageRating,
        reviews: totalReviews,
      },
    });
  } catch (error) {
    console.error('Error in getProductById:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch product details.',
      error: error.message,
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
};
