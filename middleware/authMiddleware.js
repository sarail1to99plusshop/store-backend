const crypto = require('crypto');
const User = require('../models/User');
const { isMongoConnected } = require('../config/db');

const getJwtSecret = () =>
  process.env.ADMIN_JWT_SECRET || 'sarail_admin_jwt_super_secret_key_2026_secured';

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

module.exports = {
  signAdminToken,
  verifyAdminToken,
  verifyAdmin,
};
