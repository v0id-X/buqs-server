import express from 'express';
import{
    getBooks,getBookByIsbn,searchBooks,autoCompleteBooks,getForYouFeed,getTrendingBooks,
    getSimilarBooks
} from '../controllers/book.controller.js'
import {protectRoute} from '../middlewares/auth.middleware.js';
import { apiLimiter,searchLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

router.use(protectRoute);

router.get('/',apiLimiter,getBooks);
router.get('/search',searchLimiter,searchBooks);
router.get('/autocomplete',searchLimiter,autoCompleteBooks);
router.get('/for-you',searchLimiter,getForYouFeed);
router.get('/trending',apiLimiter,getTrendingBooks); 
router.get('/:isbn/similar',apiLimiter,getSimilarBooks);
router.get('/:isbn',apiLimiter,getBookByIsbn);

export default router;