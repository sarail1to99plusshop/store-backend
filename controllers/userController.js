const User = require('../models/User');
const { isMongoConnected } = require('../config/db');
const { memoryStore } = require('../data/seedData');

// POST /api/users/register
// Stores newly registered account in MongoDB 'users' collection
const registerUser = async (req, res) => {
  try {
    const {
      uid,
      email,
      displayName,
      photoURL = '',
      phone = '',
      address = '',
      authProvider = 'password',
      emailVerified = false,
    } = req.body;

    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        message: 'uid and email are required to register a user.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date();

    if (isMongoConnected()) {
      let user = await User.findOne({
        $or: [{ uid }, { email: normalizedEmail }],
      });

      if (user) {
        user.uid = uid;
        user.email = normalizedEmail;
        if (displayName) user.displayName = displayName;
        if (photoURL) user.photoURL = photoURL;
        if (phone) user.phone = phone;
        if (address) user.address = address;
        user.emailVerified = Boolean(emailVerified);
        user.lastLoginAt = now;
        user.loginCount = (user.loginCount || 0) + 1;
        await user.save();
      } else {
        user = await User.create({
          uid,
          email: normalizedEmail,
          displayName: displayName || normalizedEmail.split('@')[0],
          photoURL,
          phone,
          address,
          role: 'customer',
          authProvider,
          emailVerified: Boolean(emailVerified),
          registeredAt: now,
          lastLoginAt: now,
          loginCount: 1,
        });
      }

      return res.status(201).json({
        success: true,
        message: 'User registered and saved in MongoDB collection.',
        user,
      });
    }

    // Fallback store if MongoDB URI is not connected yet
    let existing = memoryStore.users.find(
      (u) => u.uid === uid || u.email === normalizedEmail
    );
    if (existing) {
      existing.displayName = displayName || existing.displayName;
      existing.photoURL = photoURL || existing.photoURL;
      existing.emailVerified = Boolean(emailVerified);
      existing.lastLoginAt = now.toISOString();
      existing.updatedAt = now.toISOString();
      existing.loginCount = (existing.loginCount || 1) + 1;
    } else {
      existing = {
        _id: `usr_${Date.now()}`,
        uid,
        email: normalizedEmail,
        displayName: displayName || normalizedEmail.split('@')[0],
        photoURL,
        phone,
        address,
        role: 'customer',
        authProvider,
        emailVerified: Boolean(emailVerified),
        registeredAt: now.toISOString(),
        lastLoginAt: now.toISOString(),
        loginCount: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      memoryStore.users.push(existing);
    }

    return res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      user: existing,
    });
  } catch (error) {
    console.error('Error in registerUser:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to register user.',
      error: error.message,
    });
  }
};

// PATCH or POST /api/users/login
// Updates lastLoginAt timestamp in MongoDB whenever user logs in
const loginUser = async (req, res) => {
  try {
    const {
      uid,
      email,
      displayName,
      photoURL,
      authProvider = 'password',
      emailVerified,
    } = req.body;

    if (!uid && !email) {
      return res.status(400).json({
        success: false,
        message: 'uid or email is required to update login time.',
      });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : '';
    const now = new Date();

    if (isMongoConnected()) {
      const query =
        uid && normalizedEmail
          ? { $or: [{ uid }, { email: normalizedEmail }] }
          : uid
          ? { uid }
          : { email: normalizedEmail };

      let user = await User.findOne(query);

      if (user) {
        if (uid) user.uid = uid;
        if (normalizedEmail) user.email = normalizedEmail;
        if (displayName) user.displayName = displayName;
        if (photoURL) user.photoURL = photoURL;
        if (typeof emailVerified === 'boolean') {
          user.emailVerified = emailVerified;
        }
        user.lastLoginAt = now;
        user.loginCount = (user.loginCount || 0) + 1;
        await user.save();
      } else {
        // First-time Google sign-in or existing Firebase user syncing for the first time
        user = await User.create({
          uid: uid || `uid_${Date.now()}`,
          email: normalizedEmail,
          displayName: displayName || normalizedEmail.split('@')[0] || 'Sarail Customer',
          photoURL: photoURL || '',
          role: 'customer',
          authProvider,
          emailVerified: Boolean(emailVerified),
          registeredAt: now,
          lastLoginAt: now,
          loginCount: 1,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'User login timestamp updated in MongoDB.',
        user,
      });
    }

    // Fallback store
    let existing = memoryStore.users.find(
      (u) => (uid && u.uid === uid) || (normalizedEmail && u.email === normalizedEmail)
    );
    if (existing) {
      if (displayName) existing.displayName = displayName;
      if (photoURL) existing.photoURL = photoURL;
      if (typeof emailVerified === 'boolean') existing.emailVerified = emailVerified;
      existing.lastLoginAt = now.toISOString();
      existing.updatedAt = now.toISOString();
      existing.loginCount = (existing.loginCount || 1) + 1;
    } else {
      existing = {
        _id: `usr_${Date.now()}`,
        uid: uid || `uid_${Date.now()}`,
        email: normalizedEmail,
        displayName: displayName || (normalizedEmail ? normalizedEmail.split('@')[0] : 'Customer'),
        photoURL: photoURL || '',
        role: 'customer',
        authProvider,
        emailVerified: Boolean(emailVerified),
        registeredAt: now.toISOString(),
        lastLoginAt: now.toISOString(),
        loginCount: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      memoryStore.users.push(existing);
    }

    return res.status(200).json({
      success: true,
      message: 'User login timestamp updated.',
      user: existing,
    });
  } catch (error) {
    console.error('Error in loginUser:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update login time.',
      error: error.message,
    });
  }
};

// GET /api/users/:identifier
const getUserProfile = async (req, res) => {
  try {
    const { identifier } = req.params;
    const normalized = identifier.trim().toLowerCase();

    if (isMongoConnected()) {
      const user = await User.findOne({
        $or: [{ uid: identifier }, { email: normalized }],
      }).lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found in MongoDB.',
        });
      }

      return res.status(200).json({
        success: true,
        user,
      });
    }

    const user = memoryStore.users.find(
      (u) => u.uid === identifier || u.email === normalized
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user profile.',
      error: error.message,
    });
  }
};

// GET /api/users
const getAllUsers = async (req, res) => {
  try {
    if (isMongoConnected()) {
      const users = await User.find().sort({ lastLoginAt: -1 }).lean();
      return res.status(200).json({
        success: true,
        count: users.length,
        users,
      });
    }

    return res.status(200).json({
      success: true,
      count: memoryStore.users.length,
      users: memoryStore.users,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch users.',
      error: error.message,
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  getAllUsers,
};

