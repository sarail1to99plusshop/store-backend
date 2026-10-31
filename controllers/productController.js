const mongoose = require('mongoose');
const Product = require('../models/Product');
const Review = require('../models/Review');
const { isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');
const { computeRatingStats } = require('./reviewController');

// GET /api/products
// Supports pagination (default 10 products per page), category, tag, search, and sorting
// Helper to reject store logos and placeholders from being treated as product photos
const isInvalidProductImage = (url) => {
  if (!url || typeof url !== 'string') return true;
  const lower = url.trim().toLowerCase();
  return (
    lower === '' ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower.includes('without-bg') ||
    lower.includes('without bg') ||
    lower.includes('/logo.png') ||
    lower.endsWith('logo.png') ||
    lower.endsWith('logo.webp') ||
    lower.includes('website logo') ||
    lower.includes('product-placeholder')
  );
};

// Dynamically calculates rating & review count for each product from actual user reviews
const normalizeProductVariants = (p) => {
  if (!p) return p;
  const rawThumbnail = (p.thumbnail || '').trim();
  const validThumbnail = !isInvalidProductImage(rawThumbnail) ? rawThumbnail : '';

  const rawImages = Array.isArray(p.images)
    ? p.images.filter((img) => !isInvalidProductImage(img))
    : [];

  let fallbackFromVariant = '';
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      if (Array.isArray(v?.images)) {
        const found = v.images.find((img) => !isInvalidProductImage(img));
        if (found) {
          fallbackFromVariant = found;
          break;
        }
      }
    }
  }

  const thumbnail = validThumbnail || rawImages[0] || fallbackFromVariant || '';

  const variants = Array.isArray(p.variants) && p.variants.length > 0
    ? p.variants.map((v) => {
        const cleanVImages = Array.isArray(v?.images)
          ? v.images.filter((img) => !isInvalidProductImage(img))
          : [];
        return {
          ...v,
          images: cleanVImages.length > 0
            ? cleanVImages
            : [thumbnail].filter(Boolean),
        };
      })
    : [{ colorName: 'Standard', colorCode: '#000000', images: [thumbnail].filter(Boolean) }];

  const images = rawImages.length > 0
    ? (thumbnail ? [thumbnail, ...rawImages.filter((img) => img !== thumbnail)] : rawImages)
    : [thumbnail].filter(Boolean);

  return {
    ...p,
    thumbnail,
    variants,
    images,
  };
};

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

    // Strict product collection membership (R07 / COL-01 to COL-04)
    // Only explicitly checked collection boolean flags determine collection membership.
    // Removed all fallback inferences from tags, discounts, or recency.
    const normalizeCollections = (p) => {
      const existing = p.collections || {};
      return {
        bestSelling: Boolean(existing.bestSelling),
        newArrival: Boolean(existing.newArrival),
        hotOffer: Boolean(existing.hotOffer),
        popular: Boolean(existing.popular),
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
          variants:
            Array.isArray(p.variants) && p.variants.length > 0
              ? p.variants
              : [{ colorName: 'Standard', colorCode: '#000000', images: [p.thumbnail].filter(Boolean) }],
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
          variants:
            Array.isArray(p.variants) && p.variants.length > 0
              ? p.variants
              : [{ colorName: 'Standard', colorCode: '#000000', images: [p.thumbnail].filter(Boolean) }],
        };
      });
    }

    rawProducts = rawProducts.map(normalizeProductVariants);

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
      if (!Array.isArray(product.variants) || product.variants.length === 0) {
        product.variants = [{ colorName: 'Standard', colorCode: '#000000', images: [product.thumbnail].filter(Boolean) }];
      }

      return res.status(200).json({
        success: true,
        product: normalizeProductVariants(product),
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
      product: normalizeProductVariants({
        ...product,
        rating: averageRating,
        reviews: totalReviews,
      }),
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

const getProductOgHtml = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);

    let product = null;
    if (isMongoConnected()) {
      if (!Number.isNaN(numericId)) {
        product = await Product.findOne({ id: numericId }).lean();
      }
      if (!product && mongoose.Types.ObjectId.isValid(id)) {
        product = await Product.findById(id).lean();
      }
    }
    if (!product) {
      product = memoryStore.products.find(
        (p) => p.id === numericId || p.id?.toString() === id?.toString()
      );
    }

    const siteUrl = 'https://sarail1to99plus-shop.com';
    const fallbackImage = `${siteUrl}/Without-BG-logo.png`;
    const prodName = product?.name || 'Sarail 1 to 99 Plus Shop - Best Daily Deals';
    const prodPrice = product?.price || 110;
    const rawImage = !isInvalidProductImage(product?.thumbnail)
      ? product.thumbnail
      : (product?.images?.find((img) => !isInvalidProductImage(img)) || fallbackImage);
    const prodImage = rawImage.replace('://i.ibb.co.com/', '://i.ibb.co/');
    const prodDesc = product?.description
      ? `${product.description} | ক্যাশ অন ডেলিভারিতে সারাদেশে হোম ডেলিভারি।`
      : `Buy ${prodName} at ৳${prodPrice} with Cash on Delivery from Sarail 1 to 99 Plus Shop.`;
    const pageUrl = `${siteUrl}/product/${product?.id || id}`;

    const html = `<!doctype html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${prodName} - ৳${prodPrice} | Sarail 1 to 99 Plus Shop</title>
  <meta name="description" content="${prodDesc}" />
  <link rel="canonical" href="${pageUrl}" />
  <meta name="robots" content="index, follow" />

  <!-- Open Graph / Facebook / WhatsApp / Messenger / Telegram -->
  <meta property="og:site_name" content="Sarail 1 to 99 Plus Shop" />
  <meta property="og:type" content="product" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:title" content="${prodName} - ৳${prodPrice} | Sarail 1 to 99 Plus Shop" />
  <meta property="og:description" content="${prodDesc}" />
  <meta property="og:image" content="${prodImage}" />
  <meta property="og:image:secure_url" content="${prodImage}" />
  <meta property="og:image:alt" content="${prodName}" />
  <meta property="og:image:type" content="image/webp" />
  <meta property="og:image:width" content="600" />
  <meta property="og:image:height" content="600" />
  <meta property="og:locale" content="bn_BD" />
  <meta property="product:price:amount" content="${prodPrice}" />
  <meta property="product:price:currency" content="BDT" />

  <!-- Twitter / X Cards -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${pageUrl}" />
  <meta name="twitter:title" content="${prodName} - ৳${prodPrice} | Sarail 1 to 99 Plus Shop" />
  <meta name="twitter:description" content="${prodDesc}" />
  <meta name="twitter:image" content="${prodImage}" />
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; text-align: center;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
    <h1 style="font-size: 1.25rem; font-weight: 800; color: #003d73;">${prodName}</h1>
    <p style="font-size: 1.5rem; font-weight: 900; color: #b80d18;">৳${prodPrice}</p>
    <img src="${prodImage}" alt="${prodName}" style="max-width: 100%; height: auto; max-height: 400px; border-radius: 8px; object-fit: contain; margin: 16px 0;" />
    <p style="font-size: 0.875rem; color: #475569;">${prodDesc}</p>
    <div style="margin-top: 20px;">
      <a href="${pageUrl}" style="display: inline-block; background: #003d73; color: white; padding: 12px 24px; font-weight: bold; border-radius: 8px; text-decoration: none;">View Product in Shop</a>
    </div>
  </div>
  <script>
    if (typeof window !== 'undefined' && !/bot|crawl|spider|facebook|whatsapp|twitter|telegram|discord|slack|linkedin|pinterest/i.test(navigator.userAgent)) {
      window.location.replace(${JSON.stringify(pageUrl)});
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Error in getProductOgHtml:', error);
    return res.redirect(`https://sarail1to99plus-shop.com/product/${req.params.id}`);
  }
};

module.exports = {
  getProducts,
  getProductById,
  getProductOgHtml,
};
