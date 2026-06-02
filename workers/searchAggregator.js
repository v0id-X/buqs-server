
import cron from 'node-cron';
import pool from '../db/db.js';
import { redisConnection } from '../utils/redisConnection.js';
import zlib from 'zlib';
import { promisify } from 'util';

const deflate = promisify(zlib.deflate);

export const runSearchAggregation = async () => {
    try {
        console.log(`[Search-Cron] Building Search Dictionary...`);
        
        const query = `
            SELECT 
                b.isbn, 
                b.title, 
                b.author, 
                b.cover_image,
                b.genres,
                b.is_adult
            FROM books b
            LEFT JOIN book_stats bs ON b.isbn = bs.isbn
            ORDER BY bs.trending_score DESC NULLS LAST
        `;

        const result = await pool.query(query);

        const dictionary = result.rows.map(book => {
            const genreText = Array.isArray(book.genres) ? book.genres.join(' ') : (book.genres || '');
            return {
                isbn: book.isbn,
                title: book.title,
                author: book.author,
                cover_image: book.cover_image,
                is_adult: book.is_adult,
                searchable_string: `${book.title} ${book.author} ${genreText} ${book.isbn}`.toLowerCase()
            };
        });

        const jsonString = JSON.stringify(dictionary);
        
        const compressedBuffer = await deflate(jsonString);
        
        const base64Data = compressedBuffer.toString('base64');

        await redisConnection.set('search:dictionary', base64Data);
        
        console.log(`[Search-Cron] Search Dictionary compressed & saved to Redis. Size reduced to ~${(base64Data.length / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
        console.error(`[Search-Cron] Search Aggregation failure: `, error);
    }
};

export const startSearchAggregator = () => {
    console.log(`[Search-Cron] Search Dictionary Aggregator initialized.`);
    cron.schedule('*/5 * * * *', runSearchAggregation);
};