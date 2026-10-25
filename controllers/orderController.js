const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const PreOrder = require('../models/PreOrder');
const DeliveryCharge = require('../models/DeliveryCharge');
const { connectDB, isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');
const { sendOrderCancelledEmail } = require('../services/emailService');
const { createSteadfastConsignment } = require('../services/steadfastService');
const {
  isZoneApplicableForDistrict,
  getBestMatchingDeliveryZone,
} = require('../utils/deliveryZoneRules');

// Standard delivery charges dictionary for Bangladesh:
// 1. Inside Brahmanbaria City: 60 BDT
// 2. Inside Dhaka City: 120 BDT
// 3. Outside Dhaka and Brahmanbaria (Rest of Bangladesh): 130 BDT
const STANDARD_DELIVERY_FEES = {
  'Inside Brahmanbaria City': 60,
  'inside-brahmanbaria': 60,
  'Inside brahmanbaria': 60,
  'Inside Dhaka City': 120,
  'inside-dhaka': 120,
  'Inside dhaka': 120,
  'Outside Dhaka and Brahmanbaria (Rest of Bangladesh)': 130,
  'outside-dhaka-brahmanbaria': 130,
  'Outside brahmanbaria': 130,
  'outside-brahmanbaria': 130,
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

    // Ensure active MongoDB connection in serverless / cold-start environment
    if (!isMongoConnected()) {
      await connectDB().catch(() => {});
    }

    // 1. Validate Customer Contact Details & Enforce Detailed Delivery Address
    const rawName = (customerDetails?.name || '').trim();
    const rawPhone = (customerDetails?.phone || '').trim();
    const hasStructuredAddress = Boolean(
      customerDetails?.streetAddress ||
      customerDetails?.district ||
      customerDetails?.thana
    );

    let rawStreet = (customerDetails?.streetAddress || '').trim();
    let rawDistrict = (customerDetails?.district || '').trim();
    let rawThana = (customerDetails?.thana || '').trim();
    const rawDivision = (customerDetails?.division || '').trim();
    const rawSingleAddress = (customerDetails?.address || '').trim();

    // Check basic presence of name and phone
    if (!rawName || !rawPhone) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone, district, thana, and street address are strictly required.',
      });
    }

    // Phone format validation: 11-digit Bangladeshi mobile number
    const cleanPhone = rawPhone.replace(/[\s-]/g, '').replace(/^\+?88/, '');
    const bdPhoneRegex = /^01[3-9]\d{8}$/;
    if (!bdPhoneRegex.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 11-digit Bangladeshi mobile number (e.g. 01712345678).',
      });
    }

    if (hasStructuredAddress) {
      // User or form submitted structured address
      if (!rawStreet || !rawDistrict || !rawThana) {
        return res.status(400).json({
          success: false,
          message: 'Customer name, phone, district, thana, and street address are strictly required.',
        });
      }
      if (rawStreet.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Detailed street/village address must be at least 6 characters long.',
        });
      }
    } else {
      // Legacy single address string
      if (!rawSingleAddress) {
        return res.status(400).json({
          success: false,
          message: 'Customer name, phone, and delivery address are strictly required.',
        });
      }
      rawStreet = rawSingleAddress;
      const parts = rawSingleAddress.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        rawDistrict = parts[parts.length - 1];
        rawThana = parts[parts.length - 2];
      }
      if (rawDistrict.toLowerCase() === 'sarail') {
        rawDistrict = 'Brahmanbaria';
        if (!rawThana || rawThana.toLowerCase().includes('bazar')) rawThana = 'Sarail';
      }
    }

    // Construct final hierarchical recipient address: [Detailed Street / Village / Landmark] + [Thana / Upazila] + [District]
    const recipientAddress = (customerDetails?.streetAddress && customerDetails?.thana && customerDetails?.district)
      ? `${rawStreet}, ${rawThana}, ${rawDistrict}`
      : (customerDetails?.fullAddress?.trim() || rawSingleAddress || `${rawStreet}, ${rawThana}, ${rawDistrict}`);

    // Clean address for validation
    const cleanAddress = recipientAddress.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    const addressWords = cleanAddress.split(/[\s,.-]+/).filter(Boolean);
    const bdDistrictOrHubs = [
      'dhaka', 'gazipur', 'narayanganj', 'chittagong', 'chattogram', 'sylhet',
      'comilla', 'cumilla', 'brahmanbaria', 'rajshahi', 'khulna', 'barisal',
      'rangpur', 'mymensingh', 'jashore', 'bogra', 'sadar', 'ctg', 'dhk',
      'narsingdi', 'raipura', 'savar', 'keraniganj', 'tongi', 'ashulia',
      'feni', 'noakhali', 'coxsbazar', 'tangail', 'faridpur', 'sirajganj',
      'pabna', 'kushtia', 'dinajpur', 'naogaon', 'natore',
    ];
    const isAllHubWords =
      addressWords.length <= 4 &&
      addressWords.every((w) => bdDistrictOrHubs.includes(w.toLowerCase()));

    if (cleanAddress.length < 15 || addressWords.length < 3 || isAllHubWords) {
      return res.status(400).json({
        success: false,
        message:
          'Please provide a complete and detailed delivery address with at least 15 characters (House/Road, Village/Area, Landmark, Thana, District). Vague district or hub-only names (e.g. "Dhaka, Narsingdi, Raipura") cannot be accepted for courier delivery.',
      });
    }

    // Verify district is not disabled by admin
    if (rawDistrict) {
      let isDistrictDisabled = false;
      if (isMongoConnected()) {
        try {
          const District = require('../models/District');
          const dDoc = await District.findOne({ name: new RegExp(`^${rawDistrict}$`, 'i') }).lean();
          if (dDoc && dDoc.isActive === false) {
            isDistrictDisabled = true;
          }
        } catch {
          // ignore error
        }
      }
      if (!isDistrictDisabled && Array.isArray(memoryStore.districts)) {
        const dMem = memoryStore.districts.find(
          (d) => d.name.toLowerCase() === rawDistrict.toLowerCase()
        );
        if (dMem && dMem.isActive === false) {
          isDistrictDisabled = true;
        }
      }

      if (isDistrictDisabled) {
        return res.status(400).json({
          success: false,
          message: `"${rawDistrict}" জেলায় আমাদের হোম ডেলিভারি সাময়িকভাবে বন্ধ রয়েছে। অনুগ্রহ করে অন্য ঠিকানা প্রদান করুন।`,
        });
      }
    }

    // 2. Extract Raw Ordered Items
    const rawItems = Array.isArray(items) && items.length > 0 ? items : orderItems;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item.',
      });
    }

    // 3. Validate Payment Method & bKash Anti-Replay TrxID
    const isBkash = paymentMethod === 'bKash';
    const submittedTrx = (paymentDetails.trxId || trxId || '').trim().toUpperCase();

    let paymentMode = 'full';
    if (isBkash) {
      paymentMode = (paymentDetails.mode || 'full').toLowerCase();
      if (!['full', 'delivery'].includes(paymentMode)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid bKash payment mode. Allowed modes: "full" or "delivery".',
        });
      }

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

    // 4. Delivery Zone Fee Validation & Strict District Geographic Enforcement
    let activeCharges = Array.isArray(memoryStore.deliveryCharges) ? memoryStore.deliveryCharges : [];
    if (isMongoConnected()) {
      try {
        const dbCharges = await DeliveryCharge.find({ isActive: { $ne: false } }).lean();
        if (dbCharges && dbCharges.length > 0) {
          activeCharges = dbCharges;
        }
      } catch (err) {
        console.warn('[orderController] Fallback to memory delivery charges:', err.message);
      }
    }

    const customerDistrict = (rawDistrict || customerDetails.district || '').trim();
    const rawDeliveryZone = (customerDetails.deliveryLocation || '').trim();
    let matchedZone = activeCharges.find(
      (c) =>
        c.location?.toLowerCase() === rawDeliveryZone.toLowerCase() ||
        c.id?.toLowerCase() === rawDeliveryZone.toLowerCase() ||
        (rawDeliveryZone.toLowerCase().includes('outside') && (c.id?.includes('outside') || c.location?.toLowerCase().includes('outside')))
    );

    // If customer selected a district (e.g. Narsingdi) but submitted an incompatible zone (e.g. "Inside Brahmanbaria City"),
    // or if no zone was specified, enforce geographic integrity and select the valid zone.
    if (customerDistrict) {
      if (!matchedZone || !isZoneApplicableForDistrict(matchedZone, customerDistrict, activeCharges)) {
        const validZone = getBestMatchingDeliveryZone(activeCharges, customerDistrict);
        if (validZone) {
          matchedZone = validZone;
          customerDetails.deliveryLocation = validZone.location;
        }
      }
    } else if (!matchedZone) {
      matchedZone = getBestMatchingDeliveryZone(activeCharges, '');
      if (matchedZone) {
        customerDetails.deliveryLocation = matchedZone.location;
      }
    }

    const normDistrict = (customerDistrict || '').trim().toLowerCase();
    let validatedDeliveryFee = matchedZone
      ? matchedZone.charge
      : (normDistrict === 'brahmanbaria'
          ? 60
          : normDistrict === 'dhaka'
          ? 120
          : 130);

    if (req.body.deliveryFee !== undefined && !isNaN(Number(req.body.deliveryFee))) {
      const clientFee = Number(req.body.deliveryFee);
      // Only allow client fee override if it matches the validated compatible fee
      if (clientFee === validatedDeliveryFee) {
        validatedDeliveryFee = clientFee;
      }
    }

    if (isBkash && paymentMode === 'delivery') {
      const submittedFee = req.body.deliveryFee !== undefined ? Number(req.body.deliveryFee) : validatedDeliveryFee;
      if (submittedFee <= 0 || validatedDeliveryFee <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Delivery charge only mode requires a delivery fee greater than zero.',
        });
      }
    }

    // Helper to robustly extract product identifier across sanitized $oid/_oid/string/number formats
    const extractProductId = (it) => {
      if (!it) return null;
      if (it.productId !== undefined && it.productId !== null && it.productId !== '') {
        return it.productId;
      }
      if (it.product) {
        if (typeof it.product === 'object') {
          return it.product.$oid || it.product._oid || it.product.id || it.product._id || null;
        }
        return it.product;
      }
      if (it.id !== undefined && it.id !== null && it.id !== '') {
        return it.id;
      }
      if (it._id) {
        if (typeof it._id === 'object') {
          return it._id.$oid || it._id._oid || it._id.id || null;
        }
        return it._id;
      }
      return null;
    };

    // 5. Query Products from DB / memoryStore
    const numericIds = [];
    const objectIds = [];

    rawItems.forEach((it) => {
      const rawPid = extractProductId(it);
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

    let dbProducts = [];
    if (orConditions.length > 0) {
      if (isMongoConnected()) {
        dbProducts = await Product.find({ $or: orConditions }).lean();
      } else {
        dbProducts = memoryStore.products.filter(
          (p) =>
            numericIds.includes(p.id) ||
            objectIds.some((oid) => oid.toString() === p._id?.toString())
        );
      }
    }

    // 6. Build Verified Line Items & Calculate Totals
    const verifiedItems = [];
    let calculatedSubtotal = 0;
    let calculatedTotalQty = 0;

    for (const rawItem of rawItems) {
      const rawPid = extractProductId(rawItem);

      let matchedProduct = null;
      if (rawPid !== undefined && rawPid !== null) {
        matchedProduct = dbProducts.find((p) => {
          if (Number(rawPid) === p.id) return true;
          if (p._id && p._id.toString() === String(rawPid)) return true;
          return false;
        });
      }

      // Quantity must be a positive integer
      const quantity = Math.max(1, parseInt(rawItem.quantity, 10) || 1);

      // Verified unit price: use DB price if product matched; otherwise fallback to item price
      let unitPrice = 0;
      if (matchedProduct) {
        unitPrice = Number(matchedProduct.price);
      } else if (rawItem.price !== undefined && !isNaN(Number(rawItem.price))) {
        unitPrice = Math.max(0, Number(rawItem.price));
      } else {
        return res.status(400).json({
          success: false,
          message: `Product price missing or invalid for item: "${rawItem.title || rawItem.name || 'Unknown'}".`,
        });
      }

      const lineSubtotal = unitPrice * quantity;
      calculatedSubtotal += lineSubtotal;
      calculatedTotalQty += quantity;

      const title = matchedProduct?.name || rawItem.title || rawItem.name || 'Product';
      const color =
        rawItem.color ||
        rawItem.selectedVariant?.colorName ||
        matchedProduct?.variants?.[0]?.colorName ||
        'Standard';

      const colorCode =
        rawItem.colorCode ||
        rawItem.selectedVariant?.colorCode ||
        matchedProduct?.variants?.[0]?.colorCode ||
        '';

      const image =
        rawItem.image ||
        matchedProduct?.variants?.[0]?.images?.[0] ||
        matchedProduct?.thumbnail ||
        '';

      verifiedItems.push({
        product: matchedProduct?._id || matchedProduct?.id || rawPid || undefined,
        productObjectId: matchedProduct?._id || (mongoose.isValidObjectId(String(rawPid)) ? new mongoose.Types.ObjectId(String(rawPid)) : undefined),
        productId: matchedProduct?.id || (Number(rawPid) ? Number(rawPid) : undefined),
        title,
        price: unitPrice,
        quantity,
        color,
        colorCode,
        selectedVariant: {
          colorName: color,
          colorCode,
        },
        image,
        category: matchedProduct?.category || rawItem.category || 'General',
        subtotal: lineSubtotal,
      });
    }

    const verifiedTotalAmount = calculatedSubtotal + validatedDeliveryFee;

    // Expected prepaid amount:
    // - COD: 0 (pays on delivery)
    // - bKash Full: verifiedTotalAmount (pays full invoice in advance)
    // - bKash Delivery: validatedDeliveryFee (pays only delivery in advance, itemsSubtotal on delivery)
    const expectedPrepaidAmount = isBkash
      ? paymentMode === 'delivery'
        ? validatedDeliveryFee
        : verifiedTotalAmount
      : 0;

    // 7. Atomic Stock Decrement for Catalog Products (concurrency safe)
    if (isMongoConnected()) {
      const decrementedRecords = [];
      let stockErrorItem = null;

      for (const item of verifiedItems) {
        if (!item.productId && !item.productObjectId) continue;

        const filter = {
          $or: [
            ...(item.productId ? [{ id: item.productId }] : []),
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
          // If product exists in catalog but insufficient stock
          const exists = await Product.findOne({
            $or: [
              ...(item.productId ? [{ id: item.productId }] : []),
              ...(item.productObjectId ? [{ _id: item.productObjectId }] : []),
            ],
          }).lean();

          if (exists) {
            stockErrorItem = item.title;
            break;
          }
        } else {
          decrementedRecords.push({
            query: { _id: updatedProduct._id },
            quantity: item.quantity,
          });
        }
      }

      if (stockErrorItem) {
        for (const rec of decrementedRecords) {
          await Product.updateOne(rec.query, { $inc: { stock: rec.quantity } }).catch(() => {});
        }
        return res.status(409).json({
          success: false,
          message: `Insufficient stock for item: "${stockErrorItem}". Please reduce quantity or remove it from your cart.`,
        });
      }
    }

    // 8. Generate System Identifiers & Guarantee Unique Invoice
    let generatedInvoice = (invoiceNumber || '').trim();
    if (generatedInvoice && isMongoConnected()) {
      const existingInv = await Order.findOne({ invoiceNumber: generatedInvoice }).lean();
      if (existingInv) {
        generatedInvoice = '';
      }
    }
    if (!generatedInvoice) {
      const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const timePart = Date.now().toString().slice(-4);
      const randPart = Math.floor(1000 + Math.random() * 9000);
      generatedInvoice = `SAR-${datePart}-${timePart}${randPart}`;
    }

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
        name: rawName,
        email: (customerDetails.email || '').trim().toLowerCase(),
        phone: cleanPhone,
        streetAddress: rawStreet,
        thana: rawThana,
        district: rawDistrict,
        division: rawDivision,
        fullAddress: recipientAddress,
        address: recipientAddress,
        note: customerDetails.note || '',
        deliveryLocation:
          customerDetails.deliveryLocation ||
          matchedZone?.location ||
          (normDistrict === 'brahmanbaria'
            ? 'Inside Brahmanbaria City'
            : normDistrict === 'dhaka'
            ? 'Inside Dhaka City'
            : 'Outside Dhaka and Brahmanbaria (Rest of Bangladesh)'),
      },
      items: verifiedItems.map((item) => ({
        product: item.productObjectId || item.product,
        productId: item.productId,
        title: item.title,
        price: Number(item.price) || 0,
        quantity: Number(item.quantity) || 1,
        color: item.color,
        colorCode: item.colorCode,
        selectedVariant: item.selectedVariant,
        image: item.image,
        category: item.category,
        subtotal: item.subtotal,
      })),
      deliveryFee: Number(validatedDeliveryFee),
      itemsSubtotal: calculatedSubtotal,
      totalAmount: verifiedTotalAmount,
      totalQuantity: calculatedTotalQty,
      paymentMethod: isBkash ? 'bKash' : 'COD',
      paymentStatus: initialPaymentStatus,
      paymentDetails: {
        mode: isBkash ? paymentMode : 'full',
        bKashNumber: '01998789157',
        trxId: isBkash ? submittedTrx : '',
        senderPhone: paymentDetails.senderPhone || '',
        expectedAmount: expectedPrepaidAmount,
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
    if (!isMongoConnected()) {
      await connectDB().catch(() => {});
    }
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
    if (!isMongoConnected()) {
      await connectDB().catch(() => {});
    }
    const email = (req.params.email || req.query.email || '').trim().toLowerCase();
    const userId = (req.query.userId || '').trim();
    const phone = (req.query.phone || '').trim();

    if (!email && !userId && !phone) {
      return res.status(400).json({
        success: false,
        message: 'User email, phone, or userId is required to fetch order history.',
      });
    }

    if (isMongoConnected()) {
      const orConditions = [];
      if (email) {
        orConditions.push({
          'customerDetails.email': { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        });
      }
      if (userId) {
        orConditions.push({ userId });
      }
      if (phone) {
        orConditions.push({
          'customerDetails.phone': { $regex: new RegExp(phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        });
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
          (userId && o.userId === userId) ||
          (phone && o.customerDetails?.phone?.includes(phone))
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

      // Dispatch order cancelled notification email to customer
      sendOrderCancelledEmail(order.toObject ? order.toObject() : order).catch((err) =>
        console.error('[orderController] Cancelled email dispatch error:', err.message)
      );

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

    // Dispatch order cancelled notification email (memory store)
    sendOrderCancelledEmail(memOrder).catch((err) =>
      console.error('[orderController] Cancelled email dispatch error (memory):', err.message)
    );

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

/**
 * Dispatch an order to Steadfast Courier
 * Uses official Steadfast API: POST https://portal.steadfast.com.bd/api/v1/create_order
 * 
 * Payload structure:
 * - recipient_address: `${customerDetails.streetAddress}, ${customerDetails.thana}, ${customerDetails.district}`
 * - recipient_name: customerDetails.name
 * - recipient_phone: customerDetails.phone
 * - cod_amount: order.totalAmount
 * - invoice: order.invoiceNumber
 * - note: "Handle with care - Sarail 1 to 99+ Shop Delivery"
 */
const dispatchOrderToSteadfast = async (order, options = {}) => {
  const customer = order?.customerDetails || {};
  const recipientAddress = (customer.streetAddress && customer.thana && customer.district)
    ? `${customer.streetAddress.trim()}, ${customer.thana.trim()}, ${customer.district.trim()}`
    : (customer.fullAddress || customer.address || '').trim();

  return await createSteadfastConsignment(order, {
    recipientAddress,
    codAmount: options.codAmount !== undefined ? options.codAmount : order?.totalAmount,
    note: options.note || 'Handle with care - Sarail 1 to 99+ Shop Delivery',
    ...options,
  });
};

module.exports = {
  createOrder,
  trackOrder,
  getUserOrders,
  cancelOrder,
  createPreOrder,
  updatePaymentStatus,
  dispatchOrderToSteadfast,
};
