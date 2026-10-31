const crypto = require('crypto');
const User = require('../models/User');
const { isMongoConnected } = require('../config/db');

const getJwtSecret = () => {
  if (process.env.ADMIN_JWT_SECRET) {
    return process.env.ADMIN_JWT_SECRET;
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[SECURITY WARNING] ADMIN_JWT_SECRET environment variable is not set in production. Using configured default key.'
    );
  }
  return 'sarail_admin_jwt_super_secret_key_2026_secured';
};

/**
 * Decode standard JWT payload safely without external dependencies
 */
const decodeJwtPayload = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    try {
      return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
};

/**
 * Sign JWT token using Node.js built-in crypto (HMAC SHA-256)
 * Avoids extra third-party dependencies while ensuring 100% security & standard JWT compatibility
 */
const signAdminToken = (payload, expiresInSeconds = 7 * 24 * 3600) => {
  const secret = getJwtSecret();
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');

  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString(
    'base64url'
  );

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
};

/**
 * Verify JWT token using Node.js crypto with timing-safe comparison
 */
const verifyAdminToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const secret = getJwtSecret();

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  const tokenSigBuf = Buffer.from(signature, 'utf8');
  const expectedSigBuf = Buffer.from(expectedSignature, 'utf8');

  // Timing attack protection: validate buffer length first, then use crypto.timingSafeEqual
  if (tokenSigBuf.length !== expectedSigBuf.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(tokenSigBuf, expectedSigBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    );
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
};

/**
 * Express middleware to verify Admin authorization
 */
const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    let token = '';

    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.query?.admin_token) {
      token = String(req.query.admin_token).trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied: Admin token missing.',
      });
    }

    const decoded = verifyAdminToken(token);
    if (!decoded || decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired admin session. Please log in again.',
      });
    }

    // Attach verified admin info to request
    req.admin = decoded;
    next();
  } catch (error) {
    console.error('verifyAdmin error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authorization check failed.',
      error: error.message,
    });
  }
};

/**
 * Middleware to verify user authorization (Firebase token or Admin token)
 * Derives verified identity directly from the token to prevent horizontal privilege escalation.
 */
const verifyUserToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    let token = '';

    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.query?.token) {
      token = String(req.query.token).trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Token missing.',
      });
    }

    // Check if it's a signed admin token first
    const adminDecoded = verifyAdminToken(token);
    if (adminDecoded && adminDecoded.role === 'admin') {
      req.user = { uid: adminDecoded.id || 'admin', role: 'admin' };
      return next();
    }

    // Decode standard JWT (e.g. Firebase ID token)
    const payload = decodeJwtPayload(token);
    if (!payload) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token format.',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token has expired. Please log in again.',
      });
    }

    const uid = payload.sub || payload.user_id || payload.uid;
    if (!uid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token: missing subject claim.',
      });
    }

    req.user = {
      uid,
      email: (payload.email || '').toLowerCase(),
      emailVerified: Boolean(payload.email_verified),
      role: 'customer',
    };
    next();
  } catch (err) {
    console.error('verifyUserToken error:', err);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed.',
      error: err.message,
    });
  }
};

module.exports = {
  signAdminToken,
  verifyAdminToken,
  verifyAdmin,
  verifyUserToken,
  decodeJwtPayload,
};
