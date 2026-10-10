const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getUserProfile,
  getAllUsers,
} = require('../controllers/userController');

router.get('/', getAllUsers);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.patch('/login', loginUser);
router.get('/:identifier', getUserProfile);

module.exports = router;

