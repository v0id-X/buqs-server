import express from 'express';
import { updateLibraryStatus,getUserLibrary, getBookStatus, removeFromLibrary } from '../controllers/library.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';
import { apiLimiter,libraryAndRatingLimiter } from '../middlewares/rateLimiter.js';
const router = express.Router();

router.use(protectRoute);


router.get('/',apiLimiter,getUserLibrary);
router.post('/status',libraryAndRatingLimiter,updateLibraryStatus);
router.get('/status/:isbn',apiLimiter,getBookStatus);
router.delete('/:isbn',libraryAndRatingLimiter,removeFromLibrary);

export default router;