const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserPhone,
  getAllUsers,
} = require('../controllers/userController');
const { verifyAdmin, verifyUserToken } = require('../middleware/authMiddleware');

router.get('/', verifyAdmin, getAllUsers);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.patch('/login', loginUser);
router.put('/profile/phone', verifyUserToken, updateUserPhone);
router.patch('/profile/phone', verifyUserToken, updateUserPhone);
router.get('/:identifier', getUserProfile);

module.exports = router;

