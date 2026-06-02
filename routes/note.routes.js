import express from 'express';
import { 
    createNote, 
    getNotes, 
    getNoteById,
    updateNotes, 
    deleteNote 
} from '../controllers/note.controller.js';
import { protectRoute } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protectRoute);

router.post('/', createNote);
router.get('/', getNotes);
router.get('/:id', getNoteById);
router.put('/:id', updateNotes);
router.delete('/:id', deleteNote);

export default router;