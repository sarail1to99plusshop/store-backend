const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema(
  {
    colorName: { type: String, required: true },
    colorCode: { type: String, default: '#000000' },
    images: [{ type: String }],
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    id: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    oldPrice: {
      type: Number,
      default: null,
    },
    discount: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviews: {
      type: Number,
      default: 0,
      min: 0,
    },
    tag: {
      type: String,
      default: '',
      index: true,
    },
    collections: {
      bestSelling: { type: Boolean, default: false },
      newArrival: { type: Boolean, default: false },
      hotOffer: { type: Boolean, default: false },
      popular: { type: Boolean, default: false },
    },
    stock: {
      type: Number,
      default: 50,
      min: 0,
    },
    thumbnail: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    warranty: {
      type: String,
      default: '12 Months Replacement',
    },
    sku: {
      type: String,
      default: '',
    },
    variants: {
      type: [variantSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);

