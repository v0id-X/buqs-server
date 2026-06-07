import express from 'express';
import { getMe } from '../controllers/user.controller.js';
import {protectRoute} from '../middlewares/auth.middleware.js';
import { apiLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.get('/me',apiLimiter,protectRoute,getMe);

export default router;