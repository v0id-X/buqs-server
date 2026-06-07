
import pool from "../db/db.js";
import { trackEvent } from "../queues/analytics.queue.js"; 

export const updateLibraryStatus = async (req, res) => {
    try {
        const { isbn, status } = req.body;
        const userId = req.user.id;

        const validStatuses = ['wishlist', 'reading', 'finished'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status provided.' });
        }

        const result = await pool.query(`
            INSERT INTO user_library (user_id, isbn, status) 
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, isbn) 
            DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `, [userId, isbn, status]);

        trackEvent(userId, 'update_library', { isbn, status });

        return res.status(200).json({ 
            message: `Book moved to ${status}`, 
            libraryItem: result.rows[0] 
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

export const getBookStatus = async (req, res) => {
    try {
        const { isbn } = req.params;
        const userId = req.user.id;

        const result = await pool.query(
            'SELECT status FROM user_library WHERE user_id = $1 AND isbn = $2',
            [userId, isbn]
        );

        return res.status(200).json({ 
            status: result.rows.length > 0 ? result.rows[0].status : null 
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getUserLibrary = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, cursorDate, cursorIsbn, limit = 20 } = req.query; 

        let query = `
            SELECT 
                ul.status, 
                ul.updated_at, 
                b.isbn, 
                b.title, 
                b.author, 
                b.cover_image, 
                b.genres,
                COALESCE(bs.average_rating, 0) AS average_rating
            FROM user_library ul
            JOIN books b ON ul.isbn = b.isbn
            LEFT JOIN book_stats bs ON b.isbn = bs.isbn
            WHERE ul.user_id = $1
        `;
        
        const values = [userId];
        let paramIndex = 2;

        if (status) {
            query += ` AND ul.status = $${paramIndex++}`;
            values.push(status);
        }

        if (cursorDate && cursorIsbn) {
            query += ` AND (ul.updated_at, ul.isbn) < ($${paramIndex++}, $${paramIndex++})`;
            values.push(cursorDate, cursorIsbn);
        }

        query += ` ORDER BY ul.updated_at DESC, ul.isbn DESC LIMIT $${paramIndex}`;
        values.push(parseInt(limit, 10));

        const library = await pool.query(query, values);

        let nextCursor = null;
        if (library.rows.length === parseInt(limit, 10)) {
            const lastItem = library.rows[library.rows.length - 1];
            nextCursor = { 
                cursorDate: lastItem.updated_at, 
                cursorIsbn: lastItem.isbn 
            };
        }

        return res.status(200).json({
            data: library.rows,
            nextCursor
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const removeFromLibrary = async (req, res) => {
    try {
        const { isbn } = req.params; 
        const userId = req.user.id;

        const result = await pool.query(`
            DELETE FROM user_library 
            WHERE user_id = $1 AND isbn = $2 
            RETURNING *;
        `, [userId, isbn]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Book not found in library.' });
        }

        trackEvent(userId, 'remove_from_library', { isbn }).catch(console.error);

        return res.status(200).json({ 
            success: true, 
            message: 'Book removed from library successfully.' 
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};