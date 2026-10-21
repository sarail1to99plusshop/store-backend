const mongoose = require('mongoose');

const deliveryChargeSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    charge: {
      type: Number,
      required: true,
      min: 0,
      default: 60,
    },
    estimatedDays: {
      type: String,
      default: '1-3 Business Days',
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.DeliveryCharge ||
  mongoose.model('DeliveryCharge', deliveryChargeSchema);

