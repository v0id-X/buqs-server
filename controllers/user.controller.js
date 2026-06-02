import pool from '../db/db.js';

export const getMe = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, email, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        const user = result.rows[0];

        if (user.email === process.env.SP_EMAIL) {
            user.name = process.env.SP_NAME;
        }

        return res.status(200).json(user);
    } catch (error) {
        console.error('Error fetching /me:', error);

        return res.status(500).json({
            error: 'Internal server error'
        });
    }
}