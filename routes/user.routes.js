import express from 'express';
import { getMe } from '../controllers/user.controller.js';
import {protectRoute} from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/me',protectRoute,getMe);

export default router;