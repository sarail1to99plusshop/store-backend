const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.Mixed,
    },
    productId: {
      type: Number,
    },
    title: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    color: {
      type: String,
      default: 'Standard',
    },
    colorCode: {
      type: String,
      default: '',
    },
    selectedVariant: {
      colorName: { type: String, default: 'Standard' },
      colorCode: { type: String, default: '' },
    },
    image: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      default: 'General',
    },
    subtotal: {
      type: Number,
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
    },
    userId: {
      type: String,
      default: '',
      index: true,
    },
    customerDetails: {
      name: { type: String, required: true, trim: true },
      email: { type: String, default: '', lowercase: true, trim: true, index: true },
      phone: { type: String, required: true, trim: true, index: true },
      address: { type: String, required: true, trim: true },
      note: { type: String, default: '' },
      deliveryLocation: { type: String, default: 'Inside Dhaka' },
    },
    items: {
      type: [orderItemSchema],
      required: true,
    },
    deliveryFee: {
      type: Number,
      default: 60,
    },
    itemsSubtotal: {
      type: Number,
      required: true,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    totalQuantity: {
      type: Number,
      default: 1,
    },
    paymentMethod: {
      type: String,
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
    },
    paymentDetails: {
      mode: { type: String, default: 'full' },
      bKashNumber: { type: String, default: '01998789157' },
      trxId: { type: String, default: '', index: true },
      senderPhone: { type: String, default: '' },
      expectedAmount: { type: Number, default: 0 },
      submittedAt: { type: Date, default: Date.now },
      verifiedAt: { type: Date },
      verifiedBy: { type: String, default: '' },
      verificationNote: { type: String, default: '' },
    },
    orderStatus: {
      type: String,
      enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'],
      default: 'Pending',
    },
    courierData: {
      provider: { type: String, default: 'Steadfast' },
      consignmentId: { type: Number },
      trackingCode: { type: String },
      trackingUrl: { type: String },
      shippedAt: { type: Date, default: Date.now },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);

