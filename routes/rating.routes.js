import express from 'express'
import { submitRating,getUserRating } from '../controllers/rating.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';
import { apiLimiter,libraryAndRatingLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.use(protectRoute);

router.post('/',libraryAndRatingLimiter,submitRating);
router.get('/:isbn/me',apiLimiter,getUserRating);

export default router;