import express from 'express';
import { askLibrarian } from '../controllers/librarian.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/chat', protectRoute, askLibrarian);

export default router;