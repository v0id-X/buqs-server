import cron from 'node-cron';
import pool from '../db/db.js';

export const startAffinityCronJobs = () => {
    console.log(`[UserAffinity-Cron] Initialized.`);

    cron.schedule('*/5 * * * *', async () => {
        const startTime = Date.now();
        
        console.log(`[UserAffinity-Cron] Started User Affinity Aggregation at ${new Date().toLocaleString()}`);
        
        try {
            const affinityQuery = `
                WITH RecentEvents AS (
                    SELECT 
                        ae.user_id, 
                        ae.isbn, 
                        ae.event_type,
                        CASE 
                            WHEN ae.event_type = 'submit_rating' THEN 
                                CASE 
                                    WHEN (ae.event_data->>'rating')::numeric >= 4 THEN 1.5
                                    WHEN (ae.event_data->>'rating')::numeric = 3 THEN 0.2
                                    WHEN (ae.event_data->>'rating')::numeric <= 2 THEN -1.0
                                    ELSE 0.0
                                END
                            
                            WHEN ae.event_type = 'update_library' THEN 
                                CASE
                                    WHEN ae.event_data->>'status' = 'wishlist' THEN 1.0
                                    WHEN ae.event_data->>'status' = 'reading' THEN 1.2
                                    WHEN ae.event_data->>'status' = 'read' THEN 1.5
                                    ELSE 1.0
                                END

                            WHEN ae.event_type = 'book_view' THEN 0.2
                            ELSE 0.1
                        END as weight_delta
                    FROM analytics_events ae
                    WHERE ae.created_at >= NOW() - INTERVAL '5 minutes'
                      AND ae.user_id IS NOT NULL
                ),
                VectorMapping AS (
                    SELECT 
                        re.user_id, 
                        g.genre, 
                        b.author, 
                        re.weight_delta
                    FROM RecentEvents re
                    JOIN books b ON re.isbn = b.isbn
                    CROSS JOIN LATERAL unnest(b.genres) AS g(genre) 
                ),
                AggregatedDeltas AS (
                    SELECT 
                        user_id,
                        jsonb_object_agg(genre, total_genre_weight) as new_genre_weights,
                        jsonb_object_agg(author, total_author_weight) as new_author_weights
                    FROM (
                        SELECT 
                            user_id, 
                            genre, SUM(weight_delta) as total_genre_weight, 
                            author, SUM(weight_delta) as total_author_weight
                        FROM VectorMapping
                        GROUP BY user_id, genre, author
                    ) grouped
                    GROUP BY user_id
                )
                INSERT INTO user_affinity_weights (user_id, genre_weights, author_weights, updated_at)
                SELECT 
                    user_id, 
                    new_genre_weights, 
                    new_author_weights, 
                    NOW() 
                FROM AggregatedDeltas
                ON CONFLICT (user_id) DO UPDATE 
                SET 
                    genre_weights = (
                        SELECT jsonb_object_agg(
                            key, 
                            GREATEST(0, COALESCE((EXCLUDED.genre_weights->>key)::float, 0) + COALESCE((user_affinity_weights.genre_weights->>key)::float, 0))
                        )
                        FROM jsonb_object_keys(EXCLUDED.genre_weights || user_affinity_weights.genre_weights) AS key
                    ),
                    author_weights = (
                        SELECT jsonb_object_agg(
                            key, 
                            GREATEST(0, COALESCE((EXCLUDED.author_weights->>key)::float, 0) + COALESCE((user_affinity_weights.author_weights->>key)::float, 0))
                        )
                        FROM jsonb_object_keys(EXCLUDED.author_weights || user_affinity_weights.author_weights) AS key
                    ),
                    updated_at = NOW();
            `;

            const result = await pool.query(affinityQuery);
            const duration = Date.now() - startTime;
            
            console.log(`[UserAffinity-Cron] Success: Updated taste vectors for ${result.rowCount} active users.`);
            console.log(`[UserAffinity-Cron] Completed in ${duration}ms.`);
            
        } catch (error) {
            console.error(`[UserAffinity-Cron] ERROR: Failed to aggregate user affinity vectors:`, error);
        }
    });
};