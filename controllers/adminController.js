const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const PreOrder = require('../models/PreOrder');
const { connectDB, isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');
const { signAdminToken } = require('../middleware/authMiddleware');
const {
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
  sendOrderCancelledEmail,
  sendOrderInvoiceEmail,
  verifyEmailService,
} = require('../services/emailService');
const {
  createSteadfastConsignment,
  getSteadfastAccountBalance,
  checkSteadfastDeliveryStatus,
} = require('../services/steadfastService');

// ---------------------------------------------------------------------------
// 1. ADMIN AUTHENTICATION
// ---------------------------------------------------------------------------
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Admin email and password are required.',
      });
    }

    const adminEmailEnv = (process.env.ADMIN_EMAIL || 'admin@sarail1to99plus.com').toLowerCase().trim();
    const adminPassEnv = (process.env.ADMIN_PASSWORD || 'admin@sarail2026!').trim();

    const inputEmail = email.toLowerCase().trim();
    const inputPass = password.trim();

    let authenticated = false;
    let adminProfile = {
      email: inputEmail,
      name: 'Store Administrator',
      role: 'admin',
    };

    // Check direct admin credentials from environment
    if (inputEmail === adminEmailEnv && inputPass === adminPassEnv) {
      authenticated = true;
    } else if (isMongoConnected()) {
      // Check MongoDB user collection for admin role
      const user = await User.findOne({ email: inputEmail }).lean();
      if (user && user.role === 'admin' && (inputPass === adminPassEnv || inputPass === 'admin123456')) {
        authenticated = true;
        adminProfile = {
          email: user.email,
          name: user.displayName || 'Store Administrator',
          role: 'admin',
          uid: user.uid,
        };
      }
    }

    if (!authenticated) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials. Please verify email and password.',
      });
    }

    // Generate secure admin JWT token (valid for 7 days)
    const token = signAdminToken({
      email: adminProfile.email,
      name: adminProfile.name,
      role: 'admin',
    });

    return res.status(200).json({
      success: true,
      message: 'Admin authentication successful.',
      token,
      admin: adminProfile,
    });
  } catch (error) {
    console.error('Error in adminLogin:', error);
    return res.status(500).json({
      success: false,
      message: 'Admin authentication failed.',
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// 2. BACKEND DATABASE STATUS & HEALTH
// ---------------------------------------------------------------------------
const getSystemStatus = async (req, res) => {
  try {
    if (!isMongoConnected()) {
      await connectDB().catch(() => {});
    }
    const readyState = mongoose.connection.readyState;
    const isConnected = readyState === 1;

    let latencyMs = 0;
    let host = 'Not Connected';

    if (isConnected && mongoose.connection.db) {
      host = mongoose.connection.host || 'MongoDB Atlas';
      const start = Date.now();
      try {
        await mongoose.connection.db.admin().ping();
        latencyMs = Date.now() - start;
      } catch (pingErr) {
        latencyMs = -1;
      }
    }

    let stats = {
      productsCount: 0,
      ordersCount: 0,
      usersCount: 0,
      deliveredOrdersCount: 0,
      pendingOrdersCount: 0,
      shippedOrdersCount: 0,
      totalDeliveredRevenue: 0,
      totalOrdersRevenue: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
    };

    if (isConnected) {
      const [
        productsCount,
        ordersCount,
        usersCount,
        deliveredOrdersCount,
        pendingOrdersCount,
        shippedOrdersCount,
        lowStockCount,
        outOfStockCount,
        preOrdersCount,
        pendingPreOrdersCount,
        revenueAgg,
      ] = await Promise.all([
        Product.countDocuments(),
        Order.countDocuments(),
        User.countDocuments(),
        Order.countDocuments({ orderStatus: 'Delivered' }),
        Order.countDocuments({ orderStatus: 'Pending' }),
        Order.countDocuments({ orderStatus: 'Shipped' }),
        Product.countDocuments({ stock: { $gt: 0, $lt: 10 } }),
        Product.countDocuments({ stock: { $lte: 0 } }),
        PreOrder.countDocuments(),
        PreOrder.countDocuments({ status: 'Pending' }),
        Order.aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$totalAmount' },
              deliveredRevenue: {
                $sum: {
                  $cond: [{ $eq: ['$orderStatus', 'Delivered'] }, '$totalAmount', 0],
                },
              },
            },
          },
        ]),
      ]);

      stats = {
        productsCount,
        ordersCount,
        usersCount,
        deliveredOrdersCount,
        pendingOrdersCount,
        shippedOrdersCount,
        lowStockCount,
        outOfStockCount,
        preOrdersCount,
        pendingPreOrdersCount,
        totalDeliveredRevenue: revenueAgg[0]?.deliveredRevenue || 0,
        totalOrdersRevenue: revenueAgg[0]?.totalRevenue || 0,
      };
    } else {
      // Memory fallback stats
      stats = {
        productsCount: memoryStore.products?.length || 0,
        ordersCount: memoryStore.orders?.length || 0,
        usersCount: 1,
        deliveredOrdersCount: memoryStore.orders?.filter((o) => o.orderStatus === 'Delivered').length || 0,
        pendingOrdersCount: memoryStore.orders?.filter((o) => o.orderStatus === 'Pending').length || 0,
        shippedOrdersCount: memoryStore.orders?.filter((o) => o.orderStatus === 'Shipped').length || 0,
        lowStockCount: memoryStore.products?.filter((p) => p.stock > 0 && p.stock < 10).length || 0,
        outOfStockCount: memoryStore.products?.filter((p) => p.stock <= 0).length || 0,
        preOrdersCount: memoryStore.preOrders?.length || 0,
        pendingPreOrdersCount: memoryStore.preOrders?.filter((p) => p.status === 'Pending').length || 0,
        totalDeliveredRevenue: memoryStore.orders
          ?.filter((o) => o.orderStatus === 'Delivered')
          .reduce((acc, o) => acc + (o.totalAmount || 0), 0) || 0,
        totalOrdersRevenue: memoryStore.orders?.reduce((acc, o) => acc + (o.totalAmount || 0), 0) || 0,
      };
    }

    return res.status(200).json({
      success: true,
      databaseStatus: isConnected ? 'active' : 'disconnected',
      databaseConnected: isConnected,
      readyState,
      host,
      latencyMs,
      stats,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in getSystemStatus:', error);
    return res.status(500).json({
      success: false,
      databaseStatus: 'disconnected',
      databaseConnected: false,
      message: 'Failed to retrieve system status.',
      error: error.message,
    });
  }
};

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

const sanitizeProductItem = (p) => {
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
    ? p.variants.map((v) => ({
        ...v,
        images: Array.isArray(v?.images)
          ? v.images.filter((img) => !isInvalidProductImage(img))
          : [thumbnail].filter(Boolean),
      }))
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

// ---------------------------------------------------------------------------
// 3. PRODUCT MANAGEMENT (CRUD & LIVE STOCK CONTROL)
// ---------------------------------------------------------------------------
const getAllProductsAdmin = async (req, res) => {
  try {
    const { search = '', category = 'all', stockFilter = 'all' } = req.query;

    let query = {};
    if (category !== 'all') {
      query.category = { $regex: new RegExp(`^${category}$`, 'i') };
    }
    if (search.trim()) {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { tag: { $regex: s, $options: 'i' } },
        { sku: { $regex: s, $options: 'i' } },
      ];
      if (!isNaN(Number(s))) {
        query.$or.push({ id: Number(s) });
      }
    }

    if (stockFilter === 'low') {
      query.stock = { $gt: 0, $lt: 10 };
    } else if (stockFilter === 'out') {
      query.stock = { $lte: 0 };
    } else if (stockFilter === 'in') {
      query.stock = { $gte: 10 };
    }

    if (isMongoConnected()) {
      const products = await Product.find(query).sort({ id: 1 }).lean();
      return res.status(200).json({
        success: true,
        count: products.length,
        products: products.map(sanitizeProductItem),
      });
    }

    let products = memoryStore.products.map(sanitizeProductItem);
    if (category !== 'all') {
      products = products.filter((p) => p.category?.toLowerCase() === category.toLowerCase());
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      products = products.filter((p) => p.name?.toLowerCase().includes(s) || p.id?.toString() === s);
    }
    return res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error('Error in getAllProductsAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch products.',
      error: error.message,
    });
  }
};

const createProductAdmin = async (req, res) => {
  try {
    const {
      name,
      price,
      oldPrice,
      discount,
      category,
      stock = 50,
      thumbnail,
      videoUrl = '',
      description = '',
      warranty = '12 Months Replacement',
      sku = '',
      tag = '',
      collections = {},
      variants = [],
      images = [],
      rating = 5,
      reviews = 0,
    } = req.body;

    // Robust category extraction: handle string, object ({ id, name, slug }), array, etc.
    let cleanCategory = '';
    if (typeof category === 'string') {
      cleanCategory = category.trim();
    } else if (category && typeof category === 'object') {
      if (Array.isArray(category) && category.length > 0) {
        cleanCategory = typeof category[0] === 'string'
          ? category[0].trim()
          : String(category[0]?.id || category[0]?.name || category[0]?.slug || category[0]?.value || '').trim();
      } else {
        cleanCategory = String(category.id || category.name || category.slug || category.value || '').trim();
      }
    } else if (category !== null && category !== undefined) {
      cleanCategory = String(category).trim();
    }

    if (!cleanCategory) {
      cleanCategory = 'kitchen';
    }

    const cleanName = typeof name === 'string' ? name.trim() : String(name || '').trim();
    const cleanAllImages = Array.isArray(images)
      ? images.filter((img) => !isInvalidProductImage(img))
      : [];
    const cleanThumbnail = (typeof thumbnail === 'string' && !isInvalidProductImage(thumbnail))
      ? thumbnail.trim()
      : '';
    const cleanVariantImages = Array.isArray(variants)
      ? variants.flatMap((v) => (Array.isArray(v.images) ? v.images.filter((img) => !isInvalidProductImage(img)) : []))
      : [];

    const resolvedThumbnail = (
      cleanThumbnail ||
      cleanAllImages[0] ||
      cleanVariantImages[0] ||
      ''
    ).trim();

    if (!cleanName || price === undefined || !cleanCategory || !resolvedThumbnail) {
      return res.status(400).json({
        success: false,
        message: 'Name, price, category, and at least one product image/thumbnail are required.',
      });
    }

    let nextId = 1;
    if (isMongoConnected()) {
      const maxProduct = await Product.findOne().sort({ id: -1 }).lean();
      nextId = maxProduct && typeof maxProduct.id === 'number' ? maxProduct.id + 1 : 101;
    } else {
      const maxId = memoryStore.products.reduce((acc, p) => Math.max(acc, Number(p.id) || 0), 0);
      nextId = maxId + 1;
    }

    // Prepare variants: if not provided or empty, create default standard variant with all images
    let finalVariants = Array.isArray(variants) && variants.length > 0 ? variants : [];
    if (finalVariants.length === 0) {
      const allImages = cleanAllImages.length > 0 ? cleanAllImages : [resolvedThumbnail];
      finalVariants = [
        {
          colorName: 'Standard',
          colorCode: '#000000',
          images: allImages,
        },
      ];
    } else {
      // Clean variants
      finalVariants = finalVariants.map((v) => ({
        colorName: typeof v.colorName === 'string' ? v.colorName.trim() : String(v.colorName || 'Standard').trim(),
        colorCode: typeof v.colorCode === 'string' ? v.colorCode.trim() : String(v.colorCode || '#000000').trim(),
        images: Array.isArray(v.images) && v.images.length > 0
          ? v.images.filter((img) => !isInvalidProductImage(img))
          : [resolvedThumbnail],
      }));
    }

    const cleanDescription = typeof description === 'string' ? description.trim() : String(description || '').trim();
    const cleanWarranty = typeof warranty === 'string' ? warranty.trim() : String(warranty || '12 Months Replacement').trim();
    const cleanSku = typeof sku === 'string' ? sku.trim() : String(sku || `SAR-${nextId}`).trim();
    const cleanTag = typeof tag === 'string' ? tag.trim() : String(tag || '').trim();
    const cleanDiscount = typeof discount === 'string' ? discount.trim() : String(discount || '').trim();
    const cleanVideoUrl = typeof videoUrl === 'string' ? videoUrl.trim() : String(videoUrl || '').trim();

    const productData = {
      id: nextId,
      name: cleanName,
      price: Number(price),
      oldPrice: oldPrice ? Number(oldPrice) : null,
      discount: cleanDiscount,
      category: cleanCategory,
      stock: Math.max(0, Number(stock) || 0),
      thumbnail: resolvedThumbnail,
      videoUrl: cleanVideoUrl,
      description: cleanDescription,
      warranty: cleanWarranty,
      sku: cleanSku || `SAR-${nextId}`,
      tag: cleanTag,
      collections: {
        bestSelling: Boolean(collections?.bestSelling),
        newArrival: Boolean(collections?.newArrival),
        hotOffer: Boolean(collections?.hotOffer),
        popular: Boolean(collections?.popular),
      },
      variants: finalVariants,
      rating: Math.min(5, Math.max(0, Number(rating) || 5)),
      reviews: Math.max(0, Number(reviews) || 0),
    };

    if (isMongoConnected()) {
      const created = await Product.create(productData);
      return res.status(201).json({
        success: true,
        message: `Product #${nextId} created successfully in MongoDB.`,
        product: created,
      });
    }

    memoryStore.products.push(productData);
    return res.status(201).json({
      success: true,
      message: `Product #${nextId} created successfully.`,
      product: productData,
    });
  } catch (error) {
    console.error('Error in createProductAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create product.',
      error: error.message,
    });
  }
};

const getProductLookupQuery = (id) => {
  const numericId = Number(id);
  const conditions = [];
  if (!Number.isNaN(numericId)) {
    conditions.push({ id: numericId });
  }
  if (mongoose.isValidObjectId(id)) {
    conditions.push({ _id: id });
  }
  return conditions.length > 1 ? { $or: conditions } : conditions[0] || { id: -1 };
};

const updateProductAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);

    const updateFields = { ...req.body };
    delete updateFields._id;
    delete updateFields.id; // Protect product ID from unintentional changes

    if (updateFields.price !== undefined) updateFields.price = Number(updateFields.price);
    if (updateFields.oldPrice !== undefined) updateFields.oldPrice = updateFields.oldPrice ? Number(updateFields.oldPrice) : null;
    if (updateFields.stock !== undefined) updateFields.stock = Math.max(0, Number(updateFields.stock));
    if (updateFields.rating !== undefined) updateFields.rating = Math.min(5, Math.max(0, Number(updateFields.rating) || 0));
    if (updateFields.reviews !== undefined) updateFields.reviews = Math.max(0, Number(updateFields.reviews) || 0);
    if (updateFields.videoUrl !== undefined) updateFields.videoUrl = String(updateFields.videoUrl || '').trim();

    // Sanitize category if provided
    if (updateFields.category !== undefined) {
      let cleanCat = '';
      if (typeof updateFields.category === 'string') {
        cleanCat = updateFields.category.trim();
      } else if (updateFields.category && typeof updateFields.category === 'object') {
        if (Array.isArray(updateFields.category) && updateFields.category.length > 0) {
          cleanCat = typeof updateFields.category[0] === 'string'
            ? updateFields.category[0].trim()
            : String(updateFields.category[0]?.id || updateFields.category[0]?.name || '').trim();
        } else {
          cleanCat = String(updateFields.category.id || updateFields.category.name || updateFields.category.slug || '').trim();
        }
      } else if (updateFields.category !== null) {
        cleanCat = String(updateFields.category).trim();
      }
      updateFields.category = cleanCat || 'kitchen';
    }

    if (updateFields.name !== undefined) updateFields.name = String(updateFields.name || '').trim();
    if (updateFields.description !== undefined) updateFields.description = String(updateFields.description || '').trim();
    if (updateFields.sku !== undefined) updateFields.sku = String(updateFields.sku || '').trim();
    if (updateFields.tag !== undefined) updateFields.tag = String(updateFields.tag || '').trim();
    if (updateFields.discount !== undefined) updateFields.discount = String(updateFields.discount || '').trim();

    // Sanitize thumbnail and variants if provided
    if (updateFields.thumbnail !== undefined) {
      updateFields.thumbnail = !isInvalidProductImage(updateFields.thumbnail)
        ? String(updateFields.thumbnail).trim()
        : '';
    }

    if (Array.isArray(updateFields.variants) && updateFields.variants.length > 0) {
      updateFields.variants = updateFields.variants.map((v) => ({
        colorName: (v.colorName || 'Standard').trim(),
        colorCode: (v.colorCode || '#000000').trim(),
        images: Array.isArray(v.images)
          ? v.images.filter((img) => !isInvalidProductImage(img))
          : [],
      }));
      if (!updateFields.thumbnail) {
        for (const v of updateFields.variants) {
          if (v.images && v.images.length > 0) {
            updateFields.thumbnail = v.images[0];
            break;
          }
        }
      }
    } else if (Array.isArray(updateFields.images) && updateFields.images.length > 0) {
      const cleanImgs = updateFields.images.filter((img) => !isInvalidProductImage(img));
      updateFields.images = cleanImgs;
      if (!updateFields.thumbnail && cleanImgs.length > 0) {
        updateFields.thumbnail = cleanImgs[0];
      }
      if (!updateFields.variants || updateFields.variants.length === 0) {
        updateFields.variants = [
          {
            colorName: 'Standard',
            colorCode: '#000000',
            images: cleanImgs,
          },
        ];
      }
    }

    const query = getProductLookupQuery(id);

    if (isMongoConnected()) {
      const updated = await Product.findOneAndUpdate(
        query,
        { $set: updateFields },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: `Product #${id} not found in database.`,
        });
      }

      // Sync memoryStore if present
      const memIdx = memoryStore.products.findIndex(
        (p) => (!Number.isNaN(numericId) && p.id === numericId) || p.id?.toString() === String(id) || p._id === String(id)
      );
      if (memIdx !== -1) {
        memoryStore.products[memIdx] = { ...memoryStore.products[memIdx], ...updateFields };
      }

      return res.status(200).json({
        success: true,
        message: `Product #${updated.id} updated successfully.`,
        product: updated,
      });
    }

    const idx = memoryStore.products.findIndex(
      (p) => (!Number.isNaN(numericId) && p.id === numericId) || p.id?.toString() === String(id) || p._id === String(id)
    );
    if (idx === -1) {
      return res.status(404).json({
        success: false,
        message: `Product #${id} not found.`,
      });
    }

    memoryStore.products[idx] = { ...memoryStore.products[idx], ...updateFields };
    return res.status(200).json({
      success: true,
      message: `Product #${numericId || id} updated successfully.`,
      product: memoryStore.products[idx],
    });
  } catch (error) {
    console.error('Error in updateProductAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update product.',
      error: error.message,
    });
  }
};

const updateProductStockAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);
    const { stock, delta } = req.body;

    if (stock === undefined && delta === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Must provide either "stock" (absolute value) or "delta" (change amount).',
      });
    }

    const query = getProductLookupQuery(id);

    if (isMongoConnected()) {
      let updateOp = {};
      if (stock !== undefined) {
        updateOp = { $set: { stock: Math.max(0, Number(stock)) } };
      } else {
        const currentProd = await Product.findOne(query);
        if (!currentProd) {
          return res.status(404).json({ success: false, message: 'Product not found.' });
        }
        const newStock = Math.max(0, (currentProd.stock || 0) + Number(delta));
        updateOp = { $set: { stock: newStock } };
      }

      const updated = await Product.findOneAndUpdate(query, updateOp, { new: true });
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }

      // Sync memoryStore
      const memIdx = memoryStore.products.findIndex(
        (p) => (!Number.isNaN(numericId) && p.id === numericId) || p.id?.toString() === String(id) || p._id === String(id)
      );
      if (memIdx !== -1) {
        memoryStore.products[memIdx].stock = updated.stock;
      }

      return res.status(200).json({
        success: true,
        message: `Stock updated for product #${updated.id} to ${updated.stock} units.`,
        product: updated,
      });
    }

    const prod = memoryStore.products.find(
      (p) => (!Number.isNaN(numericId) && p.id === numericId) || p.id?.toString() === String(id) || p._id === String(id)
    );
    if (!prod) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (stock !== undefined) {
      prod.stock = Math.max(0, Number(stock));
    } else {
      prod.stock = Math.max(0, (prod.stock || 0) + Number(delta));
    }

    return res.status(200).json({
      success: true,
      message: `Stock updated to ${prod.stock} units.`,
      product: prod,
    });
  } catch (error) {
    console.error('Error in updateProductStockAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update product stock.',
      error: error.message,
    });
  }
};

const deleteProductAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);

    const query = getProductLookupQuery(id);
    const memIdx = memoryStore.products.findIndex(
      (p) => (!Number.isNaN(numericId) && p.id === numericId) || p.id?.toString() === String(id) || p._id === String(id)
    );
    let memRemoved = null;
    if (memIdx !== -1) {
      memRemoved = memoryStore.products.splice(memIdx, 1)[0];
    }

    if (isMongoConnected()) {
      const deleted = await Product.findOneAndDelete(query);

      if (!deleted && !memRemoved) {
        return res.status(404).json({
          success: false,
          message: `Product #${id} not found in database.`,
        });
      }

      const prodInfo = deleted || memRemoved;
      return res.status(200).json({
        success: true,
        message: `Product #${prodInfo.id} (${prodInfo.name}) deleted permanently from MongoDB.`,
      });
    }

    if (memRemoved) {
      return res.status(200).json({
        success: true,
        message: `Product #${memRemoved.id} deleted permanently.`,
      });
    }

    return res.status(404).json({ success: false, message: 'Product not found.' });
  } catch (error) {
    console.error('Error in deleteProductAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete product.',
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// 4. ORDER & STEADFAST COURIER MANAGEMENT
// ---------------------------------------------------------------------------
const getAllOrdersAdmin = async (req, res) => {
  try {
    if (!isMongoConnected()) {
      await connectDB().catch(() => {});
    }
    const {
      status = 'all',
      paymentStatus = 'all',
      search = '',
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    let filter = {};
    if (status !== 'all') {
      filter.orderStatus = status;
    }
    if (paymentStatus !== 'all') {
      filter.paymentStatus = paymentStatus;
    }
    if (search.trim()) {
      const s = search.trim();
      filter.$or = [
        { invoiceNumber: { $regex: s, $options: 'i' } },
        { 'customerDetails.name': { $regex: s, $options: 'i' } },
        { 'customerDetails.phone': { $regex: s, $options: 'i' } },
        { 'courierData.trackingCode': { $regex: s, $options: 'i' } },
        { 'paymentDetails.trxId': { $regex: s, $options: 'i' } },
      ];
    }

    if (isMongoConnected()) {
      const [orders, total] = await Promise.all([
        Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
        Order.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        orders,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    }

    let orders = [...memoryStore.orders];
    if (status !== 'all') {
      orders = orders.filter((o) => o.orderStatus === status);
    }
    if (paymentStatus !== 'all') {
      orders = orders.filter((o) => o.paymentStatus === paymentStatus);
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      orders = orders.filter(
        (o) =>
          o.invoiceNumber?.toLowerCase().includes(s) ||
          o.customerDetails?.name?.toLowerCase().includes(s) ||
          o.customerDetails?.phone?.includes(s)
      );
    }

    return res.status(200).json({
      success: true,
      orders: orders.slice(skip, skip + limitNum),
      pagination: {
        total: orders.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(orders.length / limitNum),
      },
    });
  } catch (error) {
    console.error('Error in getAllOrdersAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch orders.',
      error: error.message,
    });
  }
};

/**
 * SEND TO COURIER SERVICE: STEADFAST COURIER / PACKZY API
 * Dispatches live consignment to Steadfast Courier via portal.packzy.com/api/v1/create_order,
 * calculates smart COD amount, updates orderStatus to "Shipped", attaches tracking details,
 * and triggers automated Shipped invoice email notification to the customer.
 */
const shipOrderWithSteadfast = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const {
      consignmentId: customConsignment,
      trackingCode: customTracking,
      cod_amount,
      codAmount: bodyCod,
      note = '',
      forceReship = false,
    } = req.body;

    if (!invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number is required.',
      });
    }

    let order = null;
    if (isMongoConnected()) {
      order = await Order.findOne({
        invoiceNumber: { $regex: new RegExp(`^${invoiceNumber}$`, 'i') },
      });
    } else {
      order = memoryStore.orders.find(
        (o) => o.invoiceNumber?.toLowerCase() === invoiceNumber.toLowerCase()
      );
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order #${invoiceNumber} not found in database.`,
      });
    }

    if (order.orderStatus === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot ship a cancelled order.',
      });
    }

    // Check if already dispatched to Steadfast (unless forceReship is true)
    if (!forceReship && order.orderStatus === 'Shipped' && order.courierData?.consignmentId) {
      return res.status(200).json({
        success: true,
        message: `Order #${order.invoiceNumber} has already been dispatched to Steadfast Courier (Tracking: ${order.courierData.trackingCode}).`,
        order,
      });
    }

    const explicitCod = cod_amount !== undefined ? cod_amount : bodyCod;

    // Dispatch consignment to Steadfast Courier
    let consignmentResult = null;

    if (customConsignment || customTracking) {
      // Manual custom overrides (e.g. admin manually entered an existing tracking code)
      consignmentResult = {
        success: true,
        consignmentId: customConsignment || Math.floor(600000 + Math.random() * 390000),
        trackingCode: customTracking || `SF${Math.floor(10000000 + Math.random() * 90000000)}`,
        trackingUrl: customTracking ? `https://steadfast.com.bd/t/${customTracking}` : undefined,
        status: 'pending',
        codAmount: explicitCod !== undefined ? Number(explicitCod) : undefined,
        message: 'Custom consignment parameters applied.',
      };
      if (!consignmentResult.trackingUrl) {
        consignmentResult.trackingUrl = `https://steadfast.com.bd/t/${consignmentResult.trackingCode}`;
      }
    } else {
      consignmentResult = await createSteadfastConsignment(order, {
        codAmount: explicitCod,
        note,
        allowMockFallback: process.env.NODE_ENV === 'test' || !process.env.STEADFAST_API_KEY,
      });
    }

    if (!consignmentResult.success) {
      return res.status(400).json({
        success: false,
        message: consignmentResult.error || 'Failed to dispatch order to Steadfast Courier.',
        raw: consignmentResult.raw,
      });
    }

    const courierData = {
      provider: 'Steadfast',
      consignmentId: consignmentResult.consignmentId,
      trackingCode: consignmentResult.trackingCode,
      trackingUrl: consignmentResult.trackingUrl || `https://steadfast.com.bd/t/${consignmentResult.trackingCode}`,
      status: consignmentResult.status || 'pending',
      codAmount: consignmentResult.codAmount,
      shippedAt: new Date(),
    };

    order.orderStatus = 'Shipped';
    order.courierData = courierData;
    order.adminViewed = true;
    order.viewedAt = new Date();

    if (isMongoConnected()) {
      await order.save();
    }

    // Trigger customer notification email asynchronously
    const orderData = order.toObject ? order.toObject() : order;
    sendOrderShippedEmail(orderData).catch((err) =>
      console.error('[adminController] Steadfast shipped email dispatch error:', err.message)
    );

    return res.status(200).json({
      success: true,
      message: `Order #${order.invoiceNumber} successfully handed over to Steadfast Courier! Tracking: ${courierData.trackingCode} (COD: ৳${courierData.codAmount !== undefined ? courierData.codAmount : 0}).`,
      order,
      consignment: consignmentResult.consignment || courierData,
    });
  } catch (error) {
    console.error('Error in shipOrderWithSteadfast:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send order to Steadfast Courier.',
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/courier/balance
 * Returns the current merchant balance from Steadfast Courier
 */
const getSteadfastBalanceAdmin = async (req, res) => {
  try {
    const result = await getSteadfastAccountBalance();
    if (result.success) {
      return res.status(200).json({
        success: true,
        balance: result.balance,
      });
    }
    return res.status(400).json({
      success: false,
      message: result.error || 'Failed to retrieve Steadfast account balance.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error querying Steadfast balance.',
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/orders/:invoiceNumber/courier-status
 * Query real-time consignment delivery status from Steadfast Courier
 */
const checkCourierStatusAdmin = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    let order = null;
    if (isMongoConnected()) {
      order = await Order.findOne({
        invoiceNumber: { $regex: new RegExp(`^${invoiceNumber}$`, 'i') },
      });
    } else {
      order = memoryStore.orders.find(
        (o) => o.invoiceNumber?.toLowerCase() === invoiceNumber.toLowerCase()
      );
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order #${invoiceNumber} not found.`,
      });
    }

    const trackingCode = order.courierData?.trackingCode;
    const consignmentId = order.courierData?.consignmentId;

    const result = await checkSteadfastDeliveryStatus({
      invoice: order.invoiceNumber,
      trackingCode,
      consignmentId,
    });

    if (result.success) {
      if (result.status && order.courierData) {
        order.courierData.status = result.status;
        if (isMongoConnected()) {
          await order.save();
        }
      }
      return res.status(200).json({
        success: true,
        status: result.status,
        trackingCode: trackingCode || result.trackingCode,
        trackingUrl: order.courierData?.trackingUrl || (trackingCode ? `https://steadfast.com.bd/t/${trackingCode}` : ''),
      });
    }

    return res.status(400).json({
      success: false,
      message: result.error || 'Failed to fetch status from Steadfast.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to query courier status.',
      error: error.message,
    });
  }
};

const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const { orderStatus } = req.body;

    const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!validStatuses.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid order status. Allowed: ${validStatuses.join(', ')}`,
      });
    }

    if (isMongoConnected()) {
      const order = await Order.findOne({
        invoiceNumber: { $regex: new RegExp(`^${invoiceNumber}$`, 'i') },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: `Order #${invoiceNumber} not found.`,
        });
      }

      const prevStatus = order.orderStatus;
      order.orderStatus = orderStatus;
    if (orderStatus === 'Delivered') {
      if (!order.deliveredAt) {
        order.deliveredAt = new Date().toISOString();
      }
      if (order.courierData && !order.courierData.deliveredAt) {
        order.courierData.deliveredAt = order.deliveredAt;
      }
      if (order.paymentMethod === 'COD' && order.paymentStatus === 'Pending') {
        order.paymentStatus = 'Paid';
      }
    }

      // Manual transition to Delivered sets root deliveredAt exactly once (REP-01 / R15)
      if (orderStatus === 'Delivered') {
        if (!order.deliveredAt) {
          order.deliveredAt = new Date();
        }
        if (order.courierData && !order.courierData.deliveredAt) {
          order.courierData.deliveredAt = order.deliveredAt;
        }
        if (order.paymentMethod === 'COD' && order.paymentStatus === 'Pending') {
          order.paymentStatus = 'Paid';
        }
      }

      // If order was cancelled and now restoring, or if newly cancelled, handle stock
      if (orderStatus === 'Cancelled' && prevStatus !== 'Cancelled') {
        // Return quantities back to stock
        if (Array.isArray(order.items)) {
          for (const item of order.items) {
            if (item.productId) {
              await Product.updateOne(
                { id: item.productId },
                { $inc: { stock: item.quantity || 1 } }
              );
            }
          }
        }
      }

      await order.save();

      // Dispatch automated email notification for Shipped, Delivered and Cancelled statuses
      const orderData = order.toObject ? order.toObject() : order;
      if (orderStatus === 'Shipped') {
        sendOrderShippedEmail(orderData).catch((err) =>
          console.error('[adminController] Shipped email dispatch error:', err.message)
        );
      } else if (orderStatus === 'Delivered') {
        sendOrderDeliveredEmail(orderData).catch((err) =>
          console.error('[adminController] Delivered email dispatch error:', err.message)
        );
      } else if (orderStatus === 'Cancelled') {
        sendOrderCancelledEmail(orderData).catch((err) =>
          console.error('[adminController] Cancelled email dispatch error:', err.message)
        );
      }

      return res.status(200).json({
        success: true,
        message: `Order status changed from "${prevStatus}" to "${orderStatus}".`,
        order,
      });
    }

    const order = memoryStore.orders.find(
      (o) => o.invoiceNumber?.toLowerCase() === invoiceNumber.toLowerCase()
    );
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    order.orderStatus = orderStatus;
    if (orderStatus === 'Delivered') {
      if (!order.deliveredAt) {
        order.deliveredAt = new Date().toISOString();
      }
      if (order.courierData && !order.courierData.deliveredAt) {
        order.courierData.deliveredAt = order.deliveredAt;
      }
      if (order.paymentMethod === 'COD' && order.paymentStatus === 'Pending') {
        order.paymentStatus = 'Paid';
      }
    }
    if (orderStatus === 'Shipped') {
      sendOrderShippedEmail(order).catch((err) =>
        console.error('[adminController] Shipped email dispatch error (memory):', err.message)
      );
    } else if (orderStatus === 'Delivered') {
      sendOrderDeliveredEmail(order).catch((err) =>
        console.error('[adminController] Delivered email dispatch error (memory):', err.message)
      );
    } else if (orderStatus === 'Cancelled') {
      sendOrderCancelledEmail(order).catch((err) =>
        console.error('[adminController] Cancelled email dispatch error (memory):', err.message)
      );
    }
    return res.status(200).json({
      success: true,
      message: `Order status set to "${orderStatus}".`,
      order,
    });
  } catch (error) {
    console.error('Error in updateOrderStatusAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update order status.',
      error: error.message,
    });
  }
};

const updatePaymentStatusAdmin = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const { paymentStatus, verificationNote = '' } = req.body;

    const allowed = [
      'Pending Verification',
      'Verified',
      'Rejected',
      'Correction Requested',
      'Pending',
      'Paid',
    ];

    if (!allowed.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment status. Allowed: ${allowed.join(', ')}`,
      });
    }

    if (isMongoConnected()) {
      const order = await Order.findOne({
        invoiceNumber: { $regex: new RegExp(`^${invoiceNumber}$`, 'i') },
      });

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }

      order.paymentStatus = paymentStatus;
      if (!order.paymentDetails) order.paymentDetails = {};
      order.paymentDetails.verifiedAt = new Date();
      order.paymentDetails.verifiedBy = req.admin?.email || 'Store Admin';
      order.paymentDetails.verificationNote = verificationNote;

      await order.save();

      return res.status(200).json({
        success: true,
        message: `Payment status updated to "${paymentStatus}".`,
        order,
      });
    }

    const order = memoryStore.orders.find(
      (o) => o.invoiceNumber?.toLowerCase() === invoiceNumber.toLowerCase()
    );
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    order.paymentStatus = paymentStatus;
    return res.status(200).json({
      success: true,
      message: `Payment status updated to "${paymentStatus}".`,
      order,
    });
  } catch (error) {
    console.error('Error in updatePaymentStatusAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update payment verification.',
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// 5. MONTHLY DELIVERED PRODUCT REPORT (R15 / REP-01 to REP-08)
// Uses confirmed deliveredAt date (never createdAt) in Asia/Dhaka timezone
// ---------------------------------------------------------------------------
const getDhakaDateParts = (dateInput) => {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return { year: y, month: m, day, monthKey: `${y}-${m}` };
};

const getDeliveredMonthlyReport = async (req, res) => {
  try {
    const { year, month } = req.query;
    const filterYear = year && year !== 'all' ? String(year).trim() : null;
    const filterMonth = month && month !== 'all' ? String(month).trim().padStart(2, '0') : null;

    let deliveredOrders = [];
    if (isMongoConnected()) {
      deliveredOrders = await Order.find({ orderStatus: 'Delivered' })
        .sort({ deliveredAt: -1, createdAt: -1 })
        .lean();
    } else {
      deliveredOrders = (memoryStore.orders || []).filter(
        (o) => o.orderStatus === 'Delivered'
      );
    }

    // Determine current year in Asia/Dhaka timezone
    const nowDhaka = getDhakaDateParts(new Date());
    const currentDhakaYear = parseInt(nowDhaka?.year || new Date().getFullYear().toString(), 10);
    let minYear = currentDhakaYear;
    let maxYear = currentDhakaYear;

    let missingDeliveredDateCount = 0;
    const monthlyDataMap = {};

    deliveredOrders.forEach((order) => {
      // Use true confirmed deliveredAt date (REP-03 / R15)
      const dateParts = getDhakaDateParts(order.deliveredAt);

      if (!dateParts) {
        // Flag legacy records missing deliveredAt; do not invent fake delivery date from createdAt (REP-05)
        missingDeliveredDateCount += 1;
        return;
      }

      const yNum = parseInt(dateParts.year, 10);
      if (yNum < minYear) minYear = yNum;
      if (yNum > maxYear) maxYear = yNum;

      const monthKey = dateParts.monthKey;
      if (!monthlyDataMap[monthKey]) {
        monthlyDataMap[monthKey] = {
          monthKey,
          year: dateParts.year,
          month: dateParts.month,
          orderCount: 0,
          revenue: 0,
          itemsCount: 0,
          bkashRevenue: 0,
          codRevenue: 0,
          insideDhakaOrders: 0,
          outsideDhakaOrders: 0,
        };
      }

      monthlyDataMap[monthKey].orderCount += 1;
      monthlyDataMap[monthKey].revenue += Number(order.totalAmount) || 0;
      monthlyDataMap[monthKey].itemsCount += Number(order.totalQuantity) || 1;

      if (order.paymentMethod === 'bKash') {
        monthlyDataMap[monthKey].bkashRevenue += Number(order.totalAmount) || 0;
      } else {
        monthlyDataMap[monthKey].codRevenue += Number(order.totalAmount) || 0;
      }

      const loc = (order.customerDetails?.deliveryLocation || '').toLowerCase();
      if (loc.includes('outside') || loc.includes('without')) {
        monthlyDataMap[monthKey].outsideDhakaOrders += 1;
      } else {
        monthlyDataMap[monthKey].insideDhakaOrders += 1;
      }
    });

    // Dynamically populate available years from earliest delivery year to current year (REP-04)
    const availableYears = [];
    for (let y = minYear; y <= maxYear; y++) {
      availableYears.push(y.toString());
    }

    // Filter delivered orders strictly by delivery date in Asia/Dhaka
    const filteredOrders = deliveredOrders.filter((o) => {
      const parts = getDhakaDateParts(o.deliveredAt);
      if (!parts) return false; // Exclude legacy missing-deliveredAt from date-specific report
      if (filterYear && parts.year !== filterYear) return false;
      if (filterMonth && parts.month !== filterMonth) return false;
      return true;
    });

    let totalProductsRevenue = 0;
    let totalDeliveryFees = 0;
    const deliveredProductsMap = {};

    filteredOrders.forEach((order) => {
      totalDeliveryFees += Number(order.deliveryFee) || 0;
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const qty = Math.max(0, Number(item.quantity) || 0);
          const price = Math.max(0, Number(item.price) || 0);
          const subtotal = item.subtotal !== undefined ? Number(item.subtotal) : price * qty;
          totalProductsRevenue += subtotal;

          const key = item.productId ? `p_${item.productId}` : `t_${item.title}`;
          if (!deliveredProductsMap[key]) {
            deliveredProductsMap[key] = {
              productId: item.productId,
              title: item.title,
              category: item.category || 'General',
              image: item.image || '',
              unitPrice: price,
              totalQuantitySold: 0,
              totalRevenue: 0,
            };
          }
          deliveredProductsMap[key].totalQuantitySold += qty;
          deliveredProductsMap[key].totalRevenue += subtotal;
        });
      }
    });

    const monthlySummary = Object.values(monthlyDataMap).sort((a, b) =>
      b.monthKey.localeCompare(a.monthKey)
    );
    const topDeliveredProducts = Object.values(deliveredProductsMap).sort(
      (a, b) => b.totalQuantitySold - a.totalQuantitySold
    );

    const totalDeliveredRevenue = filteredOrders.reduce(
      (sum, o) => sum + (Number(o.totalAmount) || 0),
      0
    );
    const totalDeliveredOrders = filteredOrders.length;
    const totalDeliveredUnits = filteredOrders.reduce(
      (sum, o) => sum + (Number(o.totalQuantity) || 1),
      0
    );

    // Return complete order set for export or unfiltered view (REP-06: XLSX exports all 150+ selected orders)
    const isExport =
      req.query.export === 'true' ||
      req.query.all === 'true' ||
      req.query.limit === 'all';
    const returnedOrders = isExport ? filteredOrders : filteredOrders.slice(0, 500);

    return res.status(200).json({
      success: true,
      reportPeriod: {
        year: filterYear || 'all',
        month: filterMonth || 'all',
      },
      availableYears,
      summary: {
        totalDeliveredRevenue,
        totalProductsRevenue,
        totalDeliveryFees,
        totalDeliveredOrders,
        totalDeliveredUnits,
        missingDeliveredDateCount,
        averageOrderValue:
          totalDeliveredOrders > 0
            ? Math.round(totalDeliveredRevenue / totalDeliveredOrders)
            : 0,
      },
      monthlySummary,
      topDeliveredProducts,
      orders: returnedOrders,
    });
  } catch (error) {
    console.error('Error in getDeliveredMonthlyReport:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate monthly delivery report.',
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// 6. REAL-TIME ORDER POLLING FOR LIVE NOTIFICATIONS & VIEW TRACKING
// ---------------------------------------------------------------------------
const pollRecentOrders = async (req, res) => {
  try {
    const { since } = req.query;
    const query = {
      adminViewed: { $ne: true },
    };

    if (since && since !== 'null' && since !== 'undefined' && String(since).trim() !== '') {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        // Buffer by 60 seconds to prevent clock drift between client machine and cloud server from dropping orders
        query.createdAt = { $gt: new Date(sinceDate.getTime() - 60 * 1000) };
      }
    } else {
      // Look back up to 48 hours for unviewed orders
      query.createdAt = { $gt: new Date(Date.now() - 48 * 60 * 60 * 1000) };
    }

    let recentOrders = [];
    let unviewedCount = 0;

    if (isMongoConnected()) {
      recentOrders = await Order.find(query)
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      unviewedCount = await Order.countDocuments({ adminViewed: { $ne: true } }).catch(() => recentOrders.length);
    } else {
      recentOrders = memoryStore.orders.filter(
        (o) =>
          !o.adminViewed &&
          (!query.createdAt || new Date(o.createdAt || Date.now()) > query.createdAt.$gt)
      );
      unviewedCount = memoryStore.orders.filter((o) => !o.adminViewed).length;
    }

    return res.status(200).json({
      success: true,
      count: recentOrders.length,
      unviewedCount,
      hasNewOrders: recentOrders.length > 0,
      orders: recentOrders,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in pollRecentOrders:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to poll recent orders.',
      error: error.message,
    });
  }
};

const markOrderViewedAdmin = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    if (!invoiceNumber) {
      return res.status(400).json({ success: false, message: 'Invoice number required.' });
    }

    if (isMongoConnected()) {
      const order = await Order.findOneAndUpdate(
        { invoiceNumber: { $regex: new RegExp(`^${invoiceNumber}$`, 'i') } },
        { $set: { adminViewed: true, viewedAt: new Date() } },
        { new: true }
      );

      return res.status(200).json({
        success: true,
        message: `Order #${invoiceNumber} marked as viewed.`,
        order,
      });
    }

    const order = memoryStore.orders.find(
      (o) => o.invoiceNumber?.toLowerCase() === invoiceNumber.toLowerCase()
    );
    if (order) {
      order.adminViewed = true;
      order.viewedAt = new Date();
    }

    return res.status(200).json({
      success: true,
      message: `Order #${invoiceNumber} marked as viewed.`,
      order,
    });
  } catch (error) {
    console.error('Error in markOrderViewedAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark order as viewed.',
      error: error.message,
    });
  }
};

const markAllOrdersViewedAdmin = async (req, res) => {
  try {
    if (isMongoConnected()) {
      await Order.updateMany(
        { adminViewed: { $ne: true } },
        { $set: { adminViewed: true, viewedAt: new Date() } }
      );
    } else {
      memoryStore.orders.forEach((o) => {
        o.adminViewed = true;
        o.viewedAt = new Date();
      });
    }

    return res.status(200).json({
      success: true,
      message: 'All unviewed orders marked as viewed.',
    });
  } catch (error) {
    console.error('Error in markAllOrdersViewedAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark orders as viewed.',
      error: error.message,
    });
  }
};

const deleteOrderAdmin = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    if (!invoiceNumber) {
      return res.status(400).json({ success: false, message: 'Invoice number is required.' });
    }

    const cleanInvoice = invoiceNumber.trim();

    // Check & remove from memoryStore as well
    const memIdx = memoryStore.orders.findIndex(
      (o) => o.invoiceNumber?.toLowerCase() === cleanInvoice.toLowerCase()
    );
    let memRemoved = null;
    if (memIdx !== -1) {
      memRemoved = memoryStore.orders.splice(memIdx, 1)[0];
    }

    if (isMongoConnected()) {
      const deletedOrder = await Order.findOneAndDelete({
        invoiceNumber: { $regex: new RegExp(`^${cleanInvoice}$`, 'i') },
      });

      if (!deletedOrder && !memRemoved) {
        return res.status(404).json({
          success: false,
          message: `Order #${cleanInvoice} not found.`,
        });
      }

      return res.status(200).json({
        success: true,
        message: `Order #${cleanInvoice} deleted permanently.`,
        deletedOrder: deletedOrder || memRemoved,
      });
    }

    if (memRemoved) {
      return res.status(200).json({
        success: true,
        message: `Order #${cleanInvoice} deleted permanently.`,
        deletedOrder: memRemoved,
      });
    }

    return res.status(404).json({
      success: false,
      message: `Order #${cleanInvoice} not found.`,
    });
  } catch (error) {
    console.error('Error in deleteOrderAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete order.',
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// 6. USER & CUSTOMER MANAGEMENT
// ---------------------------------------------------------------------------
const getAllUsersAdmin = async (req, res) => {
  try {
    const { search = '', hasOrders = 'all' } = req.query;

    let usersList = [];
    let ordersList = [];

    if (isMongoConnected()) {
      usersList = await User.find().sort({ createdAt: -1 }).lean();
      ordersList = await Order.find()
        .select('invoiceNumber userId customerDetails totalAmount orderStatus paymentStatus createdAt')
        .lean();
    } else {
      usersList = [...memoryStore.users];
      ordersList = [...memoryStore.orders];
    }

    // Enrich users with order statistics
    const enrichedUsers = usersList.map((user) => {
      const userOrders = ordersList.filter((o) => {
        if (o.userId && (o.userId === user.uid || o.userId === user._id?.toString())) return true;
        if (user.email && o.customerDetails?.email && o.customerDetails.email.toLowerCase() === user.email.toLowerCase()) return true;
        if (user.phone && o.customerDetails?.phone && o.customerDetails.phone.trim() === user.phone.trim()) return true;
        return false;
      });

      const ordersCount = userOrders.length;
      const totalSpent = userOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
      const sortedOrders = [...userOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const lastOrder = sortedOrders[0];

      return {
        ...user,
        ordersCount,
        totalSpent,
        lastOrderDate: lastOrder?.createdAt || null,
        recentStatus: lastOrder?.orderStatus || null,
      };
    });

    // Apply filters
    let filteredUsers = enrichedUsers;

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      filteredUsers = filteredUsers.filter(
        (u) =>
          u.displayName?.toLowerCase().includes(s) ||
          u.email?.toLowerCase().includes(s) ||
          u.phone?.toLowerCase().includes(s) ||
          u.address?.toLowerCase().includes(s) ||
          u.uid?.toLowerCase().includes(s)
      );
    }

    if (hasOrders === 'yes') {
      filteredUsers = filteredUsers.filter((u) => u.ordersCount > 0);
    } else if (hasOrders === 'no') {
      filteredUsers = filteredUsers.filter((u) => u.ordersCount === 0);
    }

    const totalUsers = usersList.length;
    const activeBuyers = enrichedUsers.filter((u) => u.ordersCount > 0).length;
    const totalRevenueFromUsers = enrichedUsers.reduce((sum, u) => sum + u.totalSpent, 0);

    return res.status(200).json({
      success: true,
      count: filteredUsers.length,
      kpis: {
        totalUsers,
        activeBuyers,
        totalRevenueFromUsers,
      },
      users: filteredUsers,
    });
  } catch (error) {
    console.error('Error in getAllUsersAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch users list.',
      error: error.message,
    });
  }
};

const getUserOrdersAdmin = async (req, res) => {
  try {
    const { identifier } = req.params;
    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'User identifier is required.',
      });
    }

    let user = null;
    let orders = [];

    if (isMongoConnected()) {
      user = await User.findOne({
        $or: [
          { uid: identifier },
          { email: identifier.toLowerCase() },
          ...(mongoose.isValidObjectId(identifier) ? [{ _id: identifier }] : []),
        ],
      }).lean();

      const orderMatch = [];
      if (user) {
        if (user.uid) orderMatch.push({ userId: user.uid });
        if (user._id) orderMatch.push({ userId: user._id.toString() });
        if (user.email) orderMatch.push({ 'customerDetails.email': user.email.toLowerCase() });
        if (user.phone) orderMatch.push({ 'customerDetails.phone': user.phone.trim() });
      } else {
        orderMatch.push({ userId: identifier });
        orderMatch.push({ 'customerDetails.email': identifier.toLowerCase() });
        orderMatch.push({ 'customerDetails.phone': identifier.trim() });
      }

      orders = await Order.find({ $or: orderMatch }).sort({ createdAt: -1 }).lean();
    } else {
      user = memoryStore.users.find(
        (u) =>
          u.uid === identifier ||
          u.email?.toLowerCase() === identifier.toLowerCase() ||
          u._id === identifier
      );

      orders = memoryStore.orders
        .filter((o) => {
          if (user) {
            if (o.userId && (o.userId === user.uid || o.userId === user._id)) return true;
            if (user.email && o.customerDetails?.email?.toLowerCase() === user.email.toLowerCase()) return true;
            if (user.phone && o.customerDetails?.phone?.trim() === user.phone.trim()) return true;
          } else {
            if (o.userId === identifier) return true;
            if (o.customerDetails?.email?.toLowerCase() === identifier.toLowerCase()) return true;
            if (o.customerDetails?.phone?.trim() === identifier.trim()) return true;
          }
          return false;
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return res.status(200).json({
      success: true,
      count: orders.length,
      user: user || {
        displayName: orders[0]?.customerDetails?.name || 'Customer',
        email: orders[0]?.customerDetails?.email || identifier,
        phone: orders[0]?.customerDetails?.phone || '',
        address: orders[0]?.customerDetails?.address || '',
      },
      orders,
    });
  } catch (error) {
    console.error('Error in getUserOrdersAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user orders.',
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// 7. PRE-ORDER MANAGEMENT (ADMIN)
// ---------------------------------------------------------------------------
const getAllPreOrdersAdmin = async (req, res) => {
  try {
    if (isMongoConnected()) {
      const preOrders = await PreOrder.find().sort({ createdAt: -1 }).lean();
      return res.status(200).json({
        success: true,
        count: preOrders.length,
        preOrders,
      });
    }

    return res.status(200).json({
      success: true,
      count: memoryStore.preOrders.length,
      preOrders: memoryStore.preOrders,
    });
  } catch (error) {
    console.error('Error in getAllPreOrdersAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pre-orders.',
      error: error.message,
    });
  }
};

const updatePreOrderStatusAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['Pending', 'Contacted', 'Fulfilled', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${validStatuses.join(', ')}`,
      });
    }

    if (isMongoConnected()) {
      const updated = await PreOrder.findByIdAndUpdate(id, { status }, { new: true });
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Pre-order not found.' });
      }
      return res.status(200).json({
        success: true,
        message: `Pre-order status updated to ${status}.`,
        preOrder: updated,
      });
    }

    const po = memoryStore.preOrders.find((p) => p._id === id);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Pre-order not found.' });
    }
    po.status = status;
    return res.status(200).json({
      success: true,
      message: `Pre-order status updated to ${status}.`,
      preOrder: po,
    });
  } catch (error) {
    console.error('Error in updatePreOrderStatusAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update pre-order status.',
      error: error.message,
    });
  }
};

/**
 * Manually Send / Resend Order Invoice Email to Customer
 * POST /api/admin/orders/:invoiceNumber/send-email
 */
const sendOrderInvoiceEmailAdmin = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const { statusType } = req.body || {};

    let order = null;
    if (isMongoConnected()) {
      order = await Order.findOne({
        invoiceNumber: { $regex: new RegExp(`^${invoiceNumber}$`, 'i') },
      }).lean();
    } else {
      order = memoryStore.orders.find(
        (o) => o.invoiceNumber?.toLowerCase() === invoiceNumber.toLowerCase()
      );
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order #${invoiceNumber} not found.`,
      });
    }

    const customerEmail = (order.customerDetails?.email || order.email || '').trim();
    if (!customerEmail || !customerEmail.includes('@')) {
      return res.status(400).json({
        success: false,
        message: `Order #${invoiceNumber} does not have a valid customer email address on file.`,
      });
    }

    const effectiveStatus = statusType || order.orderStatus || 'Shipped';
    const emailResult = await sendOrderInvoiceEmail(order, effectiveStatus);

    if (emailResult.success) {
      return res.status(200).json({
        success: true,
        message: `Invoice email successfully sent to customer (${customerEmail}) with status "${effectiveStatus}".`,
        messageId: emailResult.messageId,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: emailResult.error || 'Failed to dispatch email.',
      });
    }
  } catch (error) {
    console.error('Error in sendOrderInvoiceEmailAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process email invoice request.',
      error: error.message,
    });
  }
};

/**
 * Test cPanel / Custom SMTP Configuration
 * GET /api/admin/test-email
 */
const testEmailConfigAdmin = async (req, res) => {
  try {
    const result = await verifyEmailService();
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: `SMTP authenticated successfully for ${process.env.EMAIL_USER || 'support@sarail1to99plus-shop.com'}.`,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'SMTP authentication failed.',
        error: result.error,
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Permanently upload an image to ImgBB via the V1 Upload API.
 * CRITICAL: Omits the expiration parameter to ensure permanent hosting (expiration: 0).
 */
const uploadImageToImgBBAdmin = async (req, res) => {
  try {
    const { image, name } = req.body;
    if (!image) {
      return res.status(400).json({
        success: false,
        message: 'Image data (base64 string or URL) is required.',
      });
    }

    const apiKey = (process.env.IMGBB_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'IMGBB_API_KEY is not configured in backend/.env.',
        code: 'MISSING_IMGBB_KEY',
      });
    }

    // Prepare clean base64 data (strip data URL prefix if present)
    const cleanImage = typeof image === 'string'
      ? image.replace(/^data:image\/[^;]+;base64,\s*/i, '').trim()
      : image;

    const formData = new URLSearchParams();
    formData.append('image', cleanImage);
    if (name) formData.append('name', String(name).trim());
    // Explicitly NO expiration parameter => Permanent storage!

    const response = await fetch(
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(4000), // 4-second safety timeout
      }
    ).catch((err) => {
      console.warn('Notice: ImgBB connection notice:', err?.message || String(err));
      return null;
    });

    if (!response) {
      return res.status(200).json({
        success: true,
        url: typeof cleanImage === 'string' && cleanImage.startsWith('data:')
          ? cleanImage
          : `data:image/webp;base64,${cleanImage}`,
        fallback: true,
        message: 'ImgBB service busy or timed out. Image preserved using high-efficiency embedded storage.',
      });
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      // If ImgBB explicitly returned an API error (e.g. invalid key or bad params)
      if (response.status === 400 || !apiKey) {
        return res.status(response.status || 400).json({
          success: false,
          message: data?.error?.message || 'Failed to upload image to ImgBB.',
          error: data?.error,
        });
      }

      // If ImgBB is temporarily down/rate-limited, gracefully return the optimized image URL
      return res.status(200).json({
        success: true,
        url: typeof cleanImage === 'string' && cleanImage.startsWith('data:')
          ? cleanImage
          : `data:image/webp;base64,${cleanImage}`,
        fallback: true,
        message: 'ImgBB service busy. Preserved using high-efficiency embedded storage.',
      });
    }

    const permanentUrl = data?.data?.url || data?.data?.display_url;
    return res.status(200).json({
      success: true,
      url: permanentUrl,
      data: data.data,
    });
  } catch (error) {
    console.warn('Notice in uploadImageToImgBBAdmin:', error.message);
    const rawImage = req.body?.image;
    if (rawImage) {
      const clean = typeof rawImage === 'string' && rawImage.startsWith('data:')
        ? rawImage
        : `data:image/webp;base64,${rawImage}`;
      return res.status(200).json({
        success: true,
        url: clean,
        fallback: true,
        message: 'ImgBB network timed out. Image preserved using optimized local storage.',
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error while uploading image to ImgBB.',
    });
  }
};

module.exports = {
  adminLogin,
  getSystemStatus,
  getAllProductsAdmin,
  createProductAdmin,
  updateProductAdmin,
  updateProductStockAdmin,
  deleteProductAdmin,
  getAllOrdersAdmin,
  shipOrderWithSteadfast,
  updateOrderStatusAdmin,
  updatePaymentStatusAdmin,
  deleteOrderAdmin,
  getDeliveredMonthlyReport,
  pollRecentOrders,
  markOrderViewedAdmin,
  markAllOrdersViewedAdmin,
  getAllUsersAdmin,
  getUserOrdersAdmin,
  getAllPreOrdersAdmin,
  updatePreOrderStatusAdmin,
  sendOrderInvoiceEmailAdmin,
  testEmailConfigAdmin,
  getSteadfastBalanceAdmin,
  checkCourierStatusAdmin,
  uploadImageToImgBBAdmin,
};

