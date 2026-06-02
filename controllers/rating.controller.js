import pool from '../db/db.js';
import { trackEvent } from '../queues/analytics.queue.js';

export const submitRating = async (req, res) => {
    try {
        const { isbn, rating } = req.body;
        const userId = req.user.id;

        if (!isbn || !rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                error: 'Valid ISBN and a rating between 1 and 5 are required.'
            });
        }

        const existingCheck = await pool.query(
            'SELECT id FROM ratings WHERE user_id = $1 AND isbn = $2',
            [userId, isbn]
        );

        if (existingCheck.rows.length > 0) {
            return res.status(403).json({
                error: 'You have already rated this book. Ratings are final.'
            });
        }

        const result = await pool.query(
            `
            INSERT INTO ratings (user_id, isbn, rating)
            VALUES ($1, $2, $3)
            RETURNING *;
            `,
            [userId, isbn, rating]
        );

        trackEvent(userId,'submit_rating',{isbn,rating}).catch(console.error);

        return res.status(201).json({
            message: 'Final rating saved successfully',
            rating: result.rows[0]
        });
    } catch (error) {
        console.error('Error submitting rating:', error);

        return res.status(500).json({
            error: 'Internal server error'
        });
    }
}

export const getUserRating = async (req, res) => {
    try {
        const { isbn } = req.params;
        const userId = req.user.id;

        const result = await pool.query(
            'SELECT rating FROM ratings WHERE user_id = $1 AND isbn = $2',
            [userId, isbn]
        );

        if (result.rows.length === 0) {
            return res.status(200).json({
                rating: null
            });
        }

        return res.status(200).json({
            rating: result.rows[0].rating
        });
    } catch (error) {
        console.error('Error fetching user rating:', error);

        return res.status(500).json({
            error: 'Internal server error'
        });
    }
}