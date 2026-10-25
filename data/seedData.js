const initialCategories = [
  { id: 'kitchen', name: 'Kitchen & Dining' },
  { id: 'cleaning', name: 'Cleaning & Hygiene' },
  { id: 'baby-kids', name: 'Baby & Kids' },
  { id: 'beauty', name: 'Beauty & Personal Care' },
  { id: 'melamine-crockery', name: 'Melamine & Crockery' },
  { id: 'toys', name: 'Toys & Games' },
  { id: 'home-household', name: 'Home & Household' },
  { id: 'womens-fashion', name: "Women's Fashion & Accessories" },
];

const initialDeliveryCharges = [
  {
    id: 'inside-brahmanbaria',
    location: 'Inside Brahmanbaria City',
    charge: 60,
    estimatedDays: '1-2 Business Days',
    isDefault: true,
    isActive: true,
  },
  {
    id: 'inside-dhaka',
    location: 'Inside Dhaka City',
    charge: 120,
    estimatedDays: '1-3 Business Days',
    isDefault: false,
    isActive: true,
  },
  {
    id: 'without-brahmanbaria-city',
    location: 'Without Brahmanbaria City (Rest of Bangladesh)',
    charge: 130,
    estimatedDays: '2-4 Business Days',
    isDefault: false,
    isActive: true,
  },
];

// No dummy products — all products are managed directly in MongoDB via the Admin Dashboard
const initialProducts = [];

// No pre-seeded reviews or dummy orders — all data is 100% genuine and placed by actual customers
const initialReviews = [];
const initialOrders = [];

const { BANGLADESH_DISTRICTS } = require('./bangladeshDistricts');

// Fallback in-memory store used seamlessly when MongoDB URI is not yet connected
const memoryStore = {
  users: [],
  products: initialProducts.map((p) => ({ ...p })),
  reviews: initialReviews.map((r) => ({ ...r })),
  categories: initialCategories.map((c) => ({ ...c })),
  deliveryCharges: initialDeliveryCharges.map((d) => ({ ...d })),
  districts: BANGLADESH_DISTRICTS.map((d) => ({ ...d })),
  orders: initialOrders.map((o) => ({ ...o })),
  preOrders: [],
};

module.exports = {
  initialCategories,
  initialDeliveryCharges,
  initialProducts,
  initialReviews,
  initialOrders,
  memoryStore,
};
