
import { Worker } from "bullmq";
import { redisConnection } from "../utils/redisConnection.js";
import pool from '../db/db.js';

console.log(`[Analytics-Worker] BullMQ Analytics Worker is listening`);

const worker = new Worker('analytics-queue', async (job) =>{
    const {userId,eventType,eventData} = job.data

    try{

        const dbUserId = userId ;

        const isbn = eventData.isbn || null;
        await pool.query(
            `INSERT INTO analytics_events (user_id,event_type,isbn,event_data) VALUES ($1,$2,$3,$4)`,[userId,eventType,isbn,JSON.stringify(eventData)]
        );

        switch (eventType) {
            case 'book_view':
                if (isbn) {
                    const updateResult = await pool.query(
                        `UPDATE books SET views = views + 1 WHERE isbn = $1 RETURNING views`,
                        [isbn]
                    );
                    if (updateResult.rowCount > 0) {
                        console.log(`[Analytics-Worker] Success: Incremented views for ISBN ${isbn}`);
                    }
                }
                break;

            case 'user_signup':
                console.log(`[Analytics-Worker] Success: Recorded new user signup (ID: ${userId})`);
                break;
            
            case 'user_login':
                console.log(`[Analytics-Worker] Success: User login recorded (ID: ${userId})`);
                break;
                
            case 'feed_filter_used':
                console.log(`[Analytics-Worker] Tracked filter usage: ${JSON.stringify(eventData)}`);
                break;
            case 'search':
                console.log(`[Analytics-Worker] Searched: ${JSON.stringify(eventData)}`);
                break;

            default:
                console.log(`[Analytics-Worker] Processed event: ${eventType}`);
                break;
        }

    } catch (error) {
        console.error(`[Analytics-Worker] Failed to process job: ${job.id}`, error);
    }

}, {
    connection: redisConnection,
    concurrency: 5,
    prefix: '{analytics}'
});

export default worker;