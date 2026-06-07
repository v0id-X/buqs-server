import express from 'express';
import { 
    createNote, 
    getNotes, 
    getNoteById,
    updateNotes, 
    deleteNote 
} from '../controllers/note.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';
import { apiLimiter,contentCreationLimiter } from '../middlewares/rateLimiter.js';
const router = express.Router();

router.use(protectRoute);

router.post('/',contentCreationLimiter,createNote);
router.get('/',apiLimiter,getNotes);
router.get('/:id',apiLimiter,getNoteById);
router.put('/:id',contentCreationLimiter,updateNotes);
router.delete('/:id',contentCreationLimiter,deleteNote);

export default router;