import express from 'express'
import { submitRating,getUserRating } from '../controllers/rating.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protectRoute);

router.post('/',submitRating);
router.get('/:isbn/me',getUserRating);

export default router;