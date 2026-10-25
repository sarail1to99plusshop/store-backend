require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const { connectDB, isMongoConnected } = require('./config/db');
const { getDeliveryCharges } = require('./controllers/categoryController');
const { createPreOrder } = require('./controllers/orderController');
const { getDistricts } = require('./controllers/locationController');

const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');
const courierRoutes = require('./routes/courierRoutes');
const locationRoutes = require('./routes/locationRoutes');

const app = express();

// Trust reverse proxy (Vercel / Nginx)
app.set('trust proxy', 1);

// HTTP Hardening: Helmet with standard e-commerce security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Configured CORS Allowed Origins
const configuredOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
  'https://sarail1to99plus-shop.com',
  'http://sarail1to99plus-shop.com',
  'https://www.sarail1to99plus-shop.com',
  'http://www.sarail1to99plus-shop.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:3000',
]
  .filter(Boolean)
  .map((url) => url.trim().replace(/\/+$/, ''));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (server-to-server, curl, Postman, mobile apps)
    if (!origin) {
      return callback(null, true);
    }

    const cleanOrigin = origin.trim().replace(/\/+$/, '');

    // Allow configured origins or any vercel.app deployment / local ports / custom domain
    const isAllowed =
      configuredOrigins.includes(cleanOrigin) ||
      cleanOrigin.includes('sarail1to99plus-shop.com') ||
      cleanOrigin.endsWith('.vercel.app') ||
      cleanOrigin.includes('localhost:') ||
      cleanOrigin.includes('127.0.0.1:');

    if (isAllowed) {
      return callback(null, true);
    }

    // Returning false instead of throwing Error prevents 500 status on preflight OPTIONS
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// NoSQL Injection Sanitization: scrub keys starting with '$' or '.'
app.use(mongoSanitize({ replaceWith: '_' }));

// Serverless DB connection middleware: ensures Mongoose connects on Vercel cold starts
app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// Health & Root route for Vercel verification
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    name: 'Sarail 1 to 99 Plus Shop API',
    status: 'running',
    databaseConnected: isMongoConnected(),
    endpoints: {
      products: '/api/products?page=1&limit=10',
      productById: '/api/products/:id',
      productReviews: '/api/products/:id/reviews',
      categories: '/api/categories',
      deliveryCharges: '/api/delivery-charges',
      districts: '/api/locations/districts',
      divisions: '/api/locations/divisions',
      registerUser: 'POST /api/users/register',
      loginUser: 'PATCH /api/users/login',
      orders: '/api/orders',
      trackOrder: '/api/orders/track',
      preOrders: 'POST /api/pre-orders',
    },
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    databaseConnected: isMongoConnected(),
    timestamp: new Date().toISOString(),
  });
});

// Mount API Routes
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/courier', courierRoutes);
app.use('/api/locations', locationRoutes);

// Convenience top-level endpoints
app.get('/api/delivery-charges', getDeliveryCharges);
app.get('/api/districts', getDistricts);
app.post('/api/pre-orders', createPreOrder);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found on Sarail Shop Backend.`,
  });
});

// Global Error Handler
app.use((err, req, res, _next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Start local server when not running inside Vercel serverless runtime
const PORT = process.env.PORT || 5000;
if (process.env.VERCEL !== '1' && require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Server] Sarail 1 to 99 Plus Shop Backend running on http://localhost:${PORT}`);
  });
}

// Export Express app for Vercel Serverless Functions
module.exports = app;

