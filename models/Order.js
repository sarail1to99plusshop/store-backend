const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.Mixed,
    },
    productId: {
      type: Number,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    color: {
      type: String,
      default: 'Standard',
      trim: true,
    },
    colorCode: {
      type: String,
      default: '',
      trim: true,
    },
    selectedVariant: {
      colorName: { type: String, default: 'Standard' },
      colorCode: { type: String, default: '' },
    },
    image: {
      type: String,
      default: '',
      trim: true,
    },
    category: {
      type: String,
      default: 'General',
      trim: true,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    userId: {
      type: String,
      default: '',
      index: true,
      trim: true,
    },
    customerDetails: {
      name: { type: String, required: true, trim: true },
      email: { type: String, default: '', lowercase: true, trim: true, index: true },
      phone: { type: String, required: true, trim: true, index: true },
      district: { type: String, default: '', trim: true },
      thana: { type: String, default: '', trim: true },
      streetAddress: { type: String, default: '', trim: true },
      fullAddress: { type: String, default: '', trim: true },
      address: { type: String, default: '', trim: true },
      division: { type: String, default: '', trim: true },
      note: { type: String, default: '', trim: true },
      deliveryLocation: {
        type: String,
        default: 'Inside Dhaka',
        trim: true,
      },
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'An order must contain at least one item.',
      },
    },
    deliveryFee: {
      type: Number,
      required: true,
      min: 0,
      default: 60,
    },
    itemsSubtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    totalQuantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    paymentMethod: {
      type: String,
      enum: ['COD', 'bKash'],
      default: 'COD',
    },
    paymentStatus: {
      type: String,
      enum: [
        'Pending Verification',
        'Verified',
        'Rejected',
        'Correction Requested',
        'Pending',
        'Paid',
      ],
      default: 'Pending',
      index: true,
    },
    paymentDetails: {
      mode: { type: String, default: 'full' },
      bKashNumber: { type: String, default: '01998789157' },
      trxId: { type: String, default: '', index: true, trim: true },
      senderPhone: { type: String, default: '', trim: true },
      expectedAmount: { type: Number, default: 0, min: 0 },
      submittedAt: { type: Date, default: Date.now },
      verifiedAt: { type: Date },
      verifiedBy: { type: String, default: '' },
      verificationNote: { type: String, default: '' },
    },
    orderStatus: {
      type: String,
      enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Partially Delivered'],
      default: 'Pending',
      index: true,
    },
    courierData: {
      provider: { type: String, default: 'Steadfast' },
      consignmentId: { type: mongoose.Schema.Types.Mixed, index: true },
      trackingCode: { type: String, trim: true },
      trackingUrl: { type: String, trim: true },
      status: { type: String, default: 'pending', trim: true },
      deliveryStatus: { type: String, default: '', trim: true },
      shippedAt: { type: Date, default: Date.now },
      deliveredAt: { type: Date },
      lastWebhookAt: { type: Date },
    },
    deliveredAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    adminViewed: {
      type: Boolean,
      default: false,
      index: true,
    },
    viewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for optimized query performance & security audits
orderSchema.index({ createdAt: -1, orderStatus: 1 });
orderSchema.index({ 'customerDetails.phone': 1, createdAt: -1 });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
