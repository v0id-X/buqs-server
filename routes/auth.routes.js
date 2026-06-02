import express from 'express';
import {login,register,googleAuth,forgotPassword,resetPassword} from '../controllers/auth.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/register',register);
router.post('/login',login);
router.post('/google-auth',googleAuth);
router.post('/forgot-password',forgotPassword);
router.post('/reset-password/:resetToken',resetPassword);

export default router;
