
import cron from 'node-cron';
import pool from '../db/db.js';
import { redisConnection } from '../utils/redisConnection.js'; 

export const startStatsCron = () => {
    console.log(`[Stats-Cron] Stats Aggregator initialized. Waiting for 5-minute intervals....`);

    cron.schedule('*/30 * * * *', async () => {
        console.log(`[-Stats-Cron] Starting book stats aggregation`);

        try {
            await pool.query(`
                UPDATE book_stats 
                SET trending_score = trending_score * 0.70 
                WHERE trending_score > 0.1;
            `);

            const query = `
            WITH RecentInteractions AS (
                SELECT 
                    isbn,
                    COUNT(CASE WHEN event_type = 'book_view' THEN 1 END) AS recent_views,
                    COUNT(CASE WHEN event_type = 'library_add' THEN 1 END) AS recent_adds,
                    COUNT(CASE WHEN event_type = 'search' THEN 1 END) AS recent_searches
                FROM analytics_events
                WHERE created_at >= NOW() - INTERVAL '30 minutes' AND isbn IS NOT NULL
                GROUP BY isbn
            ),
            AggregatedRatings AS (
                SELECT r.isbn, ROUND(AVG(r.rating), 2) AS avg_rating
                FROM ratings r
                WHERE r.isbn IN (SELECT isbn FROM RecentInteractions)
                GROUP BY r.isbn
            )

            UPDATE book_stats bs
            SET
                total_views = (bs.total_views + COALESCE(ri.recent_views, 0)),
                total_library_adds = (bs.total_library_adds + COALESCE(ri.recent_adds, 0)),
                total_searches = (bs.total_searches + COALESCE(ri.recent_searches, 0)),
                average_rating = COALESCE(ar.avg_rating, bs.average_rating, 0),

                engagement_score = (
                    (15.0 * (bs.total_library_adds + COALESCE(ri.recent_adds, 0)) +
                     3.0 * (bs.total_searches + COALESCE(ri.recent_searches, 0)) +
                     1.0 * (bs.total_views + COALESCE(ri.recent_views, 0)))
                    / GREATEST((bs.total_views + COALESCE(ri.recent_views, 0)), 100.0)
                ),

                trending_score = COALESCE(bs.trending_score, 0) +
                    (COALESCE(ri.recent_views, 0) * 5.0) + 
                    (COALESCE(ri.recent_adds, 0) * 15.0) + 
                    (COALESCE(ri.recent_searches, 0) * 2.0),

                base_feed_score = (
                    (COALESCE(ar.avg_rating, bs.average_rating, 0) * 0.30) +
                    (LOG(10, 1 + (bs.total_views + COALESCE(ri.recent_views, 0))) * 0.15) +
                    ((COALESCE(ri.recent_views, 0) / GREATEST(((bs.total_views + COALESCE(ri.recent_views, 0)) / 30.0), 1.0)) * 0.25) +
                    ((15.0 * (bs.total_library_adds + COALESCE(ri.recent_adds, 0)) + 3.0 * (bs.total_searches + COALESCE(ri.recent_searches, 0))) / GREATEST((bs.total_views + COALESCE(ri.recent_views, 0)), 100.0) * 0.15) +
                    (EXP(-0.138 * GREATEST(0, (EXTRACT(YEAR FROM CURRENT_DATE) - COALESCE(b.published_year, EXTRACT(YEAR FROM CURRENT_DATE))))) * 0.10)
                ),
                last_calculated_at = NOW()

            FROM RecentInteractions ri
            JOIN books b ON b.isbn = ri.isbn
            LEFT JOIN AggregatedRatings ar ON ar.isbn = ri.isbn
            WHERE bs.isbn = ri.isbn;
        `;

            const result = await pool.query(query);
            console.log(`[Stats-Cron] Aggregation of book stats complete. Updated stats for ${result.rowCount} books.`);

            console.log(`[Stats-Cron] Refreshing Redis Trending Feeds...`);

            const safeTrendingResult = await pool.query(`
                SELECT b.isbn, b.title, b.author, b.genres, b.cover_image, b.published_year, 
                       bs.average_rating, bs.trending_score 
                FROM books b JOIN book_stats bs ON b.isbn = bs.isbn
                WHERE b.is_adult = false
                ORDER BY bs.trending_score DESC NULLS LAST LIMIT 50 
            `);
            await redisConnection.set('feed:trending:safe:true', JSON.stringify(safeTrendingResult.rows), 'EX', 1800);

            const allTrendingResult = await pool.query(`
                SELECT b.isbn, b.title, b.author, b.genres, b.cover_image, b.published_year, 
                       bs.average_rating, bs.trending_score 
                FROM books b JOIN book_stats bs ON b.isbn = bs.isbn
                ORDER BY bs.trending_score DESC NULLS LAST LIMIT 50 
            `);
            await redisConnection.set('feed:trending:safe:false', JSON.stringify(allTrendingResult.rows), 'EX', 1800);

            console.log(`[Stats-Cron] Trending redis cache refreshed.`);

        } catch (error) {
            console.error(`[Stats-Cron] Book stats aggregation failure: `, error);
        }
    });
};
