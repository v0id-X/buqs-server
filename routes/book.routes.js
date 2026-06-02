import express from 'express';
import{
    getBooks,getBookByIsbn,searchBooks,autoCompleteBooks,getForYouFeed,getTrendingBooks,
    getSimilarBooks
} from '../controllers/book.controller.js'
import {protectRoute} from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protectRoute);

router.get('/',getBooks);
router.get('/search',searchBooks);
router.get('/autocomplete',autoCompleteBooks);
router.get('/for-you',getForYouFeed);
router.get('/trending',getTrendingBooks); 
router.get('/:isbn/similar',getSimilarBooks);
router.get('/:isbn',getBookByIsbn);

export default router;