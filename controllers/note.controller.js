
import pool from "../db/db.js";

export const createNote = async (req, res) => {
    try {
        const { title, content } = req.body;
        const userId = req.user.id;

        const newNote = await pool.query(`
            INSERT INTO notes (user_id, title, content) 
            VALUES ($1, $2, $3) RETURNING *
        `, [userId, title || '', content || '']);

        return res.status(201).json(newNote.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export const getNotes = async (req, res) => {
    try {
        const userId = req.user.id;
        const { cursorDate, cursorId, limit = 15, search } = req.query;

        let query = `SELECT * FROM notes WHERE user_id = $1`;
        const values = [userId];
        let paramIndex = 2;

        if (search) {
            query += ` AND (title || ' ' || content) ILIKE $${paramIndex++}`;
            values.push(`%${search}%`);
        }

        if (cursorDate && cursorId) {
            query += ` AND (updated_at, id) < ($${paramIndex++}, $${paramIndex++})`;
            values.push(cursorDate, cursorId);
        }

        query += ` ORDER BY updated_at DESC, id DESC LIMIT $${paramIndex}`;
        values.push(parseInt(limit, 10));

        const notes = await pool.query(query, values);

        let nextCursor = null;
        if (notes.rows.length === parseInt(limit, 10)) {
            const lastItem = notes.rows[notes.rows.length - 1];
            nextCursor = {
                cursorDate: lastItem.updated_at,
                cursorId: lastItem.id
            };
        }

        return res.status(200).json({
            data: notes.rows,
            nextCursor
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

export const getNoteById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        
        const note = await pool.query(
            `SELECT * FROM notes WHERE id = $1 AND user_id = $2`, 
            [id, userId]
        );

        if (note.rows.length === 0) return res.status(404).json({ message: 'Note not found' });
        return res.status(200).json(note.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

export const updateNotes = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content } = req.body;
        const userId = req.user.id;

        const updatedNote = await pool.query(`
            UPDATE notes 
            SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $3 AND user_id = $4 RETURNING *
        `, [title, content, id, userId]);

        if (updatedNote.rows.length === 0) {
            return res.status(404).json({ message: 'Unauthorized or note not found' });
        }

        return res.status(200).json(updatedNote.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

export const deleteNote = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const deleteResult = await pool.query(
            'DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, userId]
        );

        if (deleteResult.rows.length === 0) {
            return res.status(404).json({ error: 'Note not found or unauthorized' });
        }

        return res.status(200).json({ message: 'Note deleted successfully', id });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}