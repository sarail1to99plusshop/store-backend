const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const PreOrder = require('../models/PreOrder');
const { isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');

// Allowed server-side delivery fee dictionary
const SERVER_DELIVERY_FEES = {
  'Inside Dhaka': 60,
  'inside-dhaka': 60,
  'Outside Dhaka': 120,
  'outside-dhaka': 120,
};

/**
 * POST /api/orders
 * Production-hardened order creation:
 * 1. Zero-Trust Server-Side Price Verification (client price is completely discarded)
 * 2. Strict Delivery Zone Fee validation against server dictionary
 * 3. Anti-Replay bKash TrxID Deduplication
 * 4. True Atomic Stock Decrement with Compensating Rollback (concurrency safe, stock never drops below 0)
 */
const createOrder = async (req, res) => {
  try {
    const {
      invoiceNumber,
      userId = '',
      customerDetails,
      items,
      orderItems,
      paymentMethod = 'COD',
      paymentDetails = {},
      trxId = '',
      courierData,
    } = req.body;

    // 1. Validate Customer Contact Details
    if (!customerDetails?.name || !customerDetails?.phone || !customerDetails?.address) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone, and delivery address are strictly required.',
      });
    }

    // 2. Extract Raw Ordered Items (Zero-Trust: ignore client price/subtotal)
    const rawItems = Array.isArray(items) && items.length > 0 ? items : orderItems;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item.',
      });
    }

    // 3. Batch Query MongoDB for all matching product IDs
    const numericIds = [];
    const objectIds = [];

    rawItems.forEach((it) => {
      const rawPid =
        it.productId !== undefined && it.productId !== null && it.productId !== ''
          ? it.productId
          : it.product?.$oid || it.product || it.id || it._id;

      if (rawPid !== undefined && rawPid !== null && rawPid !== '') {
        const num = Number(rawPid);
        if (!isNaN(num)) {
          numericIds.push(num);
        }
        if (mongoose.isValidObjectId(String(rawPid))) {
          objectIds.push(new mongoose.Types.ObjectId(String(rawPid)));
        }
      }
    });

    const orConditions = [];
    if (numericIds.length > 0) orConditions.push({ id: { $in: numericIds } });
    if (objectIds.length > 0) orConditions.push({ _id: { $in: objectIds } });

    if (orConditions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid product identifiers provided in order items.',
      });
    }

    let dbProducts = [];
    if (isMongoConnected()) {
      dbProducts = await Product.find({ $or: orConditions }).lean();
    } else {
      dbProducts = memoryStore.products.filter(
        (p) =>
          numericIds.includes(p.id) ||
          objectIds.some((oid) => oid.toString() === p._id?.toString())
      );
    }

    // 4. Calculate Line Totals, Subtotal & Total Quantity Using Verified DB Prices Only
    const verifiedItems = [];
    let calculatedSubtotal = 0;
    let calculatedTotalQty = 0;

    for (const rawItem of rawItems) {
      const rawPid =
        rawItem.productId !== undefined && rawItem.productId !== null && rawItem.productId !== ''
          ? rawItem.productId
          : rawItem.product?.$oid || rawItem.product || rawItem.id || rawItem._id;

      const matchedProduct = dbProducts.find((p) => {
        if (rawPid !== undefined && rawPid !== null) {
          if (Number(rawPid) === p.id) return true;
          if (p._id && p._id.toString() === String(rawPid)) return true;
        }
        return false;
      });

      if (!matchedProduct) {
        return res.status(400).json({
          success: false,
          message: `Product #${rawPid} was not found in the catalog or has been discontinued.`,
        });
      }

      // Quantity must be a positive integer
      const quantity = Math.max(1, parseInt(rawItem.quantity, 10) || 1);
      const verifiedUnitPrice = Number(matchedProduct.price);
      if (isNaN(verifiedUnitPrice) || verifiedUnitPrice < 0) {
        return res.status(500).json({
          success: false,
          message: `Internal price configuration error for product #${matchedProduct.id}.`,
        });
      }

      const lineSubtotal = verifiedUnitPrice * quantity;
      calculatedSubtotal += lineSubtotal;
      calculatedTotalQty += quantity;

      const color =
        rawItem.color ||
        rawItem.selectedVariant?.colorName ||
        matchedProduct.variants?.[0]?.colorName ||
        'Standard';

      const colorCode =
        rawItem.colorCode ||
        rawItem.selectedVariant?.colorCode ||
        matchedProduct.variants?.[0]?.colorCode ||
        '';

      verifiedItems.push({
        product: matchedProduct._id || matchedProduct.id,
        productObjectId: matchedProduct._id,
        productId: matchedProduct.id,
        title: matchedProduct.name,
        price: verifiedUnitPrice, // Server verified price!
        quantity,
        color,
        colorCode,
        selectedVariant: {
          colorName: color,
          colorCode,
        },
        image:
          rawItem.image ||
          matchedProduct.variants?.[0]?.images?.[0] ||
          matchedProduct.thumbnail ||
          '',
        category: matchedProduct.category || 'General',
        subtotal: lineSubtotal,
      });
    }

    // 5. Server-Side Delivery Fee Validation
    const rawDeliveryZone = (customerDetails.deliveryLocation || '').trim();
    const isOutsideDhaka = rawDeliveryZone.toLowerCase().includes('outside');
    const verifiedDeliveryLocation = isOutsideDhaka ? 'Outside Dhaka' : 'Inside Dhaka';
    const verifiedDeliveryFee = SERVER_DELIVERY_FEES[verifiedDeliveryLocation] || 60;
    const verifiedTotalAmount = calculatedSubtotal + verifiedDeliveryFee;

    // 6. bKash Anti-Replay TrxID Verification
    const isBkash = paymentMethod === 'bKash';
    const submittedTrx = (paymentDetails.trxId || trxId || '').trim().toUpperCase();

    if (isBkash) {
      if (!submittedTrx || submittedTrx.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'A valid bKash Transaction ID (minimum 6 characters) is required.',
        });
      }

      if (isMongoConnected()) {
        const existingTrx = await Order.findOne({
          'paymentDetails.trxId': submittedTrx,
        }).lean();

        if (existingTrx) {
          return res.status(400).json({
            success: false,
            message: 'This Transaction ID has already been submitted for another order. Replay of TrxID is blocked.',
          });
        }
      } else {
        const memTrx = memoryStore.orders.find(
          (o) => o.paymentDetails?.trxId === submittedTrx
        );
        if (memTrx) {
          return res.status(400).json({
            success: false,
            message: 'This Transaction ID has already been submitted for another order.',
          });
        }
      }
    }

    // 7. True Atomic Stock Decrement & Concurrency Safety
    // Stock never drops below zero ($gte: item.quantity); rollback on any item failure
    const decrementedRecords = [];
    let stockErrorItem = null;

    if (isMongoConnected()) {
      for (const item of verifiedItems) {
        const filter = {
          $or: [
            { id: item.productId },
            ...(item.productObjectId ? [{ _id: item.productObjectId }] : []),
          ],
          stock: { $gte: item.quantity },
        };

        const updatedProduct = await Product.findOneAndUpdate(
          filter,
          { $inc: { stock: -item.quantity } },
          { new: true }
        );

        if (!updatedProduct) {
          stockErrorItem = item.title;
          break;
        }

        decrementedRecords.push({
          query: { _id: updatedProduct._id },
          quantity: item.quantity,
        });
      }

      // If any item failed atomic decrement: rollback all previously decremented items!
      if (stockErrorItem) {
        for (const rec of decrementedRecords) {
          await Product.updateOne(rec.query, { $inc: { stock: rec.quantity } }).catch(() => {});
        }
        return res.status(409).json({
          success: false,
          message: `Insufficient stock for item: "${stockErrorItem}". Please reduce quantity or remove it from your cart.`,
        });
      }
    } else {
      for (const item of verifiedItems) {
        const memProd = memoryStore.products.find((p) => p.id === item.productId);
        if (!memProd || (memProd.stock || 0) < item.quantity) {
          stockErrorItem = item.title;
          break;
        }
        memProd.stock -= item.quantity;
        decrementedRecords.push({ id: memProd.id, quantity: item.quantity });
      }

      if (stockErrorItem) {
        for (const rec of decrementedRecords) {
          const memProd = memoryStore.products.find((p) => p.id === rec.id);
          if (memProd) memProd.stock += rec.quantity;
        }
        return res.status(409).json({
          success: false,
          message: `Insufficient stock for item: "${stockErrorItem}".`,
        });
      }
    }

    // 8. Generate System Identifiers
    const generatedInvoice =
      invoiceNumber ||
      `SAR-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

    const consignmentId =
      courierData?.consignmentId || Math.floor(500000 + Math.random() * 90000);
    const trackingCode =
      courierData?.trackingCode ||
      `SF${Math.floor(10000000 + Math.random() * 90000000)}`;

    const initialPaymentStatus = isBkash ? 'Pending Verification' : 'Pending';

    // 9. Build Verified Order Payload
    const orderPayload = {
      invoiceNumber: generatedInvoice,
      userId: String(userId || '').trim(),
      customerDetails: {
        name: customerDetails.name.trim(),
        email: (customerDetails.email || '').trim().toLowerCase(),
        phone: customerDetails.phone.trim(),
        address: customerDetails.address.trim(),
        note: (customerDetails.note || '').trim(),
        deliveryLocation: verifiedDeliveryLocation,
      },
      items: verifiedItems,
      deliveryFee: verifiedDeliveryFee,
      itemsSubtotal: calculatedSubtotal,
      totalAmount: verifiedTotalAmount,
      totalQuantity: calculatedTotalQty,
      paymentMethod: isBkash ? 'bKash' : 'COD',
      paymentStatus: initialPaymentStatus,
      paymentDetails: {
        mode: paymentDetails.mode || 'full',
        bKashNumber: '01998789157',
        trxId: submittedTrx,
        senderPhone: paymentDetails.senderPhone || '',
        expectedAmount: verifiedTotalAmount,
        submittedAt: new Date(),
        verifiedAt: null,
        verifiedBy: '',
        verificationNote: '',
      },
      orderStatus: 'Pending',
      courierData: {
        provider: courierData?.provider || 'Steadfast',
        consignmentId,
        trackingCode,
        trackingUrl:
          courierData?.trackingUrl || `https://steadfast.com.bd/t/${trackingCode}`,
        shippedAt: new Date(),
      },
      adminViewed: false,
    };

    if (isMongoConnected()) {
      const savedOrder = await Order.create(orderPayload);
      return res.status(201).json({
        success: true,
        message: 'Order placed and verified successfully in MongoDB.',
        order: savedOrder,
      });
    }

    const fallbackOrder = {
      _id: `ord_${Date.now()}`,
      ...orderPayload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryStore.orders.unshift(fallbackOrder);

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully.',
      order: fallbackOrder,
    });
  } catch (error) {
    console.error('Error in createOrder:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create order due to server error.',
      error: error.message,
    });
  }
};

/**
 * GET /api/orders/track?invoiceNumber=...&phone=...
 */
const trackOrder = async (req, res) => {
  try {
    const { invoiceNumber = '', phone = '' } = req.query;
    const inv = invoiceNumber.trim();
    const ph = phone.trim();

    if (!inv && !ph) {
      return res.status(400).json({
        success: false,
        message: 'Provide an invoiceNumber or phone number to track order.',
      });
    }

    if (isMongoConnected()) {
      const conditions = [];
      if (inv) {
        conditions.push({
          invoiceNumber: { $regex: new RegExp(`^${inv}$`, 'i') },
        });
      }
      if (ph) {
        conditions.push({
          'customerDetails.phone': { $regex: new RegExp(ph, 'i') },
        });
      }

      const order = await Order.findOne({ $or: conditions })
        .sort({ createdAt: -1 })
        .lean();

      if (order) {
        return res.status(200).json({
          success: true,
          order,
        });
      }
    }

    const matched = memoryStore.orders.find(
      (o) =>
        (inv && o.invoiceNumber?.toLowerCase() === inv.toLowerCase()) ||
        (ph && o.customerDetails?.phone?.includes(ph))
    );

    if (matched) {
      return res.status(200).json({
        success: true,
        order: matched,
      });
    }

    return res.status(404).json({
      success: false,
      message: 'No matching order found.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to track order.',
      error: error.message,
    });
  }
};

/**
 * GET /api/orders or GET /api/orders/user/:email
 */
const getUserOrders = async (req, res) => {
  try {
    const email = (req.params.email || req.query.email || '').trim().toLowerCase();
    const userId = (req.query.userId || '').trim();

    if (!email && !userId) {
      return res.status(400).json({
        success: false,
        message: 'User email or userId is required to fetch order history.',
      });
    }

    if (isMongoConnected()) {
      const orConditions = [];
      if (email) {
        orConditions.push({
          'customerDetails.email': { $regex: new RegExp(`^${email}$`, 'i') },
        });
      }
      if (userId) {
        orConditions.push({ userId });
      }

      const orders = await Order.find({ $or: orConditions })
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({
        success: true,
        totalOrders: orders.length,
        orders,
      });
    }

    const orders = memoryStore.orders
      .filter(
        (o) =>
          (email && o.customerDetails?.email?.toLowerCase() === email) ||
          (userId && o.userId === userId)
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt?.$date || b.createdAt || 0) -
          new Date(a.createdAt?.$date || a.createdAt || 0)
      );

    return res.status(200).json({
      success: true,
      totalOrders: orders.length,
      orders,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user orders.',
      error: error.message,
    });
  }
};

/**
 * POST /api/pre-orders
 */
const createPreOrder = async (req, res) => {
  try {
    const { productName, customerName, phone, email = '', notes = '' } = req.body;
    if (!productName || !customerName || !phone) {
      return res.status(400).json({
        success: false,
        message: 'productName, customerName, and phone are required.',
      });
    }

    if (isMongoConnected()) {
      const preOrder = await PreOrder.create({
        productName: String(productName).trim(),
        customerName: String(customerName).trim(),
        phone: String(phone).trim(),
        email: String(email).trim().toLowerCase(),
        notes: String(notes).trim(),
      });
      return res.status(201).json({
        success: true,
        message: 'Pre-order saved in MongoDB.',
        preOrder,
      });
    }

    const preOrder = {
      _id: `pre_${Date.now()}`,
      productName,
      customerName,
      phone,
      email,
      notes,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };
    memoryStore.preOrders.unshift(preOrder);

    return res.status(201).json({
      success: true,
      message: 'Pre-order request received.',
      preOrder,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create pre-order.',
      error: error.message,
    });
  }
};

/**
 * PATCH /api/orders/:invoiceNumber/cancel
 */
const cancelOrder = async (req, res) => {
  try {
    const inv = (req.params.invoiceNumber || req.body?.invoiceNumber || '').trim();

    if (!inv) {
      return res.status(400).json({
        success: false,
        message: 'Invoice number is required to cancel an order.',
      });
    }

    if (isMongoConnected()) {
      const order = await Order.findOne({
        invoiceNumber: { $regex: new RegExp(`^${inv}$`, 'i') },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found.',
        });
      }

      if (order.orderStatus === 'Shipped' || order.orderStatus === 'Delivered') {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel order because it is already ${order.orderStatus}.`,
        });
      }

      if (order.orderStatus === 'Cancelled') {
        return res.status(400).json({
          success: false,
          message: 'This order is already cancelled.',
        });
      }

      order.orderStatus = 'Cancelled';
      await order.save();

      // Restore stock when order is cancelled
      if (Array.isArray(order.items)) {
        for (const it of order.items) {
          if (it.productId) {
            await Product.updateOne({ id: it.productId }, { $inc: { stock: it.quantity } }).catch(() => {});
          }
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Order has been cancelled successfully.',
        order,
      });
    }

    const memOrder = memoryStore.orders.find(
      (o) => o.invoiceNumber?.toLowerCase() === inv.toLowerCase()
    );

    if (!memOrder) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    if (memOrder.orderStatus === 'Shipped' || memOrder.orderStatus === 'Delivered') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order because it is already ${memOrder.orderStatus}.`,
      });
    }

    if (memOrder.orderStatus === 'Cancelled') {
      return res.status(400).json({
        success: false,
        message: 'This order is already cancelled.',
      });
    }

    memOrder.orderStatus = 'Cancelled';
    memOrder.updatedAt = new Date().toISOString();

    return res.status(200).json({
      success: true,
      message: 'Order has been cancelled successfully.',
      order: memOrder,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel order.',
      error: error.message,
    });
  }
};

/**
 * PATCH /api/orders/:invoiceNumber/payment-status
 */
const updatePaymentStatus = async (req, res) => {
  try {
    const inv = (req.params.invoiceNumber || req.body?.invoiceNumber || '').trim();
    const { paymentStatus, note = '', verifiedBy = 'Admin' } = req.body;

    const allowed = ['Pending Verification', 'Verified', 'Rejected', 'Correction Requested', 'Pending', 'Paid'];
    if (!allowed.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid paymentStatus. Must be one of: ${allowed.join(', ')}`,
      });
    }

    if (isMongoConnected()) {
      const order = await Order.findOne({
        invoiceNumber: { $regex: new RegExp(`^${inv}$`, 'i') },
      });

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }

      order.paymentStatus = paymentStatus;
      if (!order.paymentDetails) order.paymentDetails = {};
      order.paymentDetails.verifiedAt = new Date();
      order.paymentDetails.verifiedBy = verifiedBy;
      if (note) order.paymentDetails.verificationNote = note;

      await order.save();

      return res.status(200).json({
        success: true,
        message: `Payment status updated to ${paymentStatus}.`,
        order,
      });
    }

    const memOrder = memoryStore.orders.find(
      (o) => o.invoiceNumber?.toLowerCase() === inv.toLowerCase()
    );

    if (!memOrder) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    memOrder.paymentStatus = paymentStatus;
    if (!memOrder.paymentDetails) memOrder.paymentDetails = {};
    memOrder.paymentDetails.verifiedAt = new Date().toISOString();
    memOrder.paymentDetails.verifiedBy = verifiedBy;
    if (note) memOrder.paymentDetails.verificationNote = note;
    memOrder.updatedAt = new Date().toISOString();

    return res.status(200).json({
      success: true,
      message: `Payment status updated to ${paymentStatus}.`,
      order: memOrder,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update payment status.',
      error: error.message,
    });
  }
};

module.exports = {
  createOrder,
  trackOrder,
  getUserOrders,
  cancelOrder,
  createPreOrder,
  updatePaymentStatus,
};
