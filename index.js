require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const { connectDB, isMongoConnected } = require('./config/db');
const { getDeliveryCharges } = require('./controllers/categoryController');
const { createPreOrder } = require('./controllers/orderController');

const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');

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

// Strict CORS: Restrict origin strictly to allowed origins array
const allowedOrigins = [process.env.FRONTEND_URL, process.env.ADMIN_URL];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server, mobile requests, or whitelisted frontend/admin origins
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Blocked by CORS: Origin ${origin} not allowed.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  })
);

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

// Convenience top-level endpoints
app.get('/api/delivery-charges', getDeliveryCharges);
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

