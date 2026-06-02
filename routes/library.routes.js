import express from 'express';
import { updateLibraryStatus,getUserLibrary, getBookStatus, removeFromLibrary } from '../controllers/library.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protectRoute);


router.get('/',getUserLibrary);
router.post('/status',updateLibraryStatus);
router.get('/status/:isbn',getBookStatus);
router.delete('/:isbn',removeFromLibrary);

export default router;