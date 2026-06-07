import express from 'express';
import {login,register,googleAuth,forgotPassword,resetPassword} from '../controllers/auth.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';
import { authLimiter } from '../middlewares/rateLimiter.js';
const router = express.Router();

router.post('/register',authLimiter,register);
router.post('/login',authLimiter,login);
router.post('/google-auth',authLimiter,googleAuth);
router.post('/forgot-password',authLimiter,forgotPassword);
router.post('/reset-password/:resetToken',authLimiter,resetPassword);

export default router;
