const Order = require('../models/Order');
const PreOrder = require('../models/PreOrder');
const { isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');

// POST /api/orders
const createOrder = async (req, res) => {
  try {
    const {
      invoiceNumber,
      userId = '',
      customerDetails,
      items,
      deliveryFee = 60,
      itemsSubtotal,
      totalAmount,
      totalQuantity,
      paymentMethod = 'COD',
      paymentDetails = {},
      trxId = '',
      courierData,
    } = req.body;

    if (!customerDetails?.name || !customerDetails?.phone || !customerDetails?.address) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone, and address are required.',
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item.',
      });
    }

    const isBkash = paymentMethod === 'bKash';
    const submittedTrx = (paymentDetails.trxId || trxId || '').trim().toUpperCase();

    if (isBkash) {
      if (!submittedTrx) {
        return res.status(400).json({
          success: false,
          message: 'Transaction ID (TrxID) is required for bKash payments.',
        });
      }
      if (submittedTrx.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid bKash Transaction ID.',
        });
      }

      // Check duplicate TrxID to prevent duplicate reuse
      if (isMongoConnected()) {
        const existingTrx = await Order.findOne({
          'paymentDetails.trxId': submittedTrx,
        }).lean();
        if (existingTrx) {
          return res.status(400).json({
            success: false,
            message: 'This Transaction ID has already been submitted for another order. Please check and provide the correct TrxID.',
          });
        }
      } else {
        const memTrx = memoryStore.orders.find(
          (o) => o.paymentDetails?.trxId === submittedTrx
        );
        if (memTrx) {
          return res.status(400).json({
            success: false,
            message: 'This Transaction ID has already been submitted for another order. Please check and provide the correct TrxID.',
          });
        }
      }
    }

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

    const computedSubtotal =
      itemsSubtotal ||
      items.reduce(
        (acc, it) => acc + (Number(it.price) || 0) * (Number(it.quantity) || 1),
        0
      );

    const computedTotal = totalAmount || computedSubtotal + Number(deliveryFee);

    const initialPaymentStatus = isBkash ? 'Pending Verification' : 'Pending';

    const orderPayload = {
      invoiceNumber: generatedInvoice,
      userId,
      customerDetails: {
        name: customerDetails.name,
        email: customerDetails.email || '',
        phone: customerDetails.phone,
        address: customerDetails.address,
        note: customerDetails.note || '',
        deliveryLocation: customerDetails.deliveryLocation || 'Inside Dhaka',
      },
      items: items.map((item) => ({
        product: item.product,
        productId: Number(item.productId) || undefined,
        title: item.title || item.name,
        price: Number(item.price) || 0,
        quantity: Number(item.quantity) || 1,
        color: item.color || item.selectedVariant?.colorName || 'Standard',
        colorCode: item.colorCode || item.selectedVariant?.colorCode || '',
        selectedVariant: {
          colorName: item.color || item.selectedVariant?.colorName || 'Standard',
          colorCode: item.colorCode || item.selectedVariant?.colorCode || '',
        },
        image: item.image || '',
        category: item.category || 'General',
        subtotal: (Number(item.price) || 0) * (Number(item.quantity) || 1),
      })),
      deliveryFee: Number(deliveryFee),
      itemsSubtotal: computedSubtotal,
      totalAmount: computedTotal,
      totalQuantity:
        totalQuantity ||
        items.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0),
      paymentMethod: isBkash ? 'bKash' : 'COD',
      paymentStatus: initialPaymentStatus,
      paymentDetails: {
        mode: paymentDetails.mode || 'full',
        bKashNumber: '01998789157',
        trxId: submittedTrx,
        senderPhone: paymentDetails.senderPhone || '',
        expectedAmount: computedTotal,
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
    };

    if (isMongoConnected()) {
      const savedOrder = await Order.create(orderPayload);
      return res.status(201).json({
        success: true,
        message: 'Order saved in MongoDB.',
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
      message: 'Failed to create order.',
      error: error.message,
    });
  }
};

// GET /api/orders/track?invoiceNumber=...&phone=...
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

// GET /api/orders or GET /api/orders/user/:email
// Returns the user's order history sorted by newest first
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

// POST /api/pre-orders
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
        productName,
        customerName,
        phone,
        email,
        notes,
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

// PATCH /api/orders/:invoiceNumber/cancel
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

// PATCH /api/orders/:invoiceNumber/payment-status
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


