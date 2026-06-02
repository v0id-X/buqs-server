import pool from '../db/db.js';
import { trackEvent } from '../queues/analytics.queue.js';
import { redisConnection } from '../utils/redisConnection.js';
import { getCohortBucket, seededRandom } from '../utils/random.js';
import { allFuseIndex, safeFuseIndex } from '../utils/searchCache.js'; 
import crypto from 'crypto';

const CANDIDATE_POOL_SIZE = 300;

export const getBooks = async (req, res) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    console.time(`[Feed:${requestId}] total`);

    try {
        const { sort = 'discovery' } = req.query;
        console.log(`\n[Feed:${requestId}] Incoming Request | Sort=${sort}`);

        if (sort === 'discovery') {
            return await getDiscoveryFeed(req, res, requestId);
        }
        return await getStandardFeed(req, res, requestId);
    } catch (error) {
        console.error(`[Feed:${requestId}] ERROR`, { message: error.message, stack: error.stack });
        console.timeEnd(`[Feed:${requestId}] total`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

const getDiscoveryFeed = async (req, res, requestId) => {
    const userId = req?.user?.id;
    const limit = parseInt(req.query.limit) || 20;
    const { genre, shuffle, safe_mode } = req.query;
    const offset = parseInt(req.query.offset) || 0;
    const poolStartVal = req.query.poolStartVal || null;
    const poolStartIsbn = req.query.poolStartIsbn || null;
    
    const isSafeMode = safe_mode === 'true';

    console.log(`[Feed:${requestId}] Discovery Feed | User=${userId} | Limit=${limit} | Offset=${offset} | Genre=${genre || 'all'} | Shuffle=${shuffle || false} | Safe=${isSafeMode}`);

    const bucketId = shuffle === 'true' 
        ? Math.floor(Math.random() * 100000).toString() 
        : getCohortBucket(userId, 20).toString();

    const cacheKey = `books:pool:bucket_${bucketId}:${genre || 'all'}:${poolStartIsbn || 'top'}:safe:${isSafeMode}`;

    let masterPool = [];
    let nextPoolStartVal = null;
    let nextPoolStartIsbn = null;

    if (shuffle !== 'true') {
        const cachedPool = await redisConnection.get(cacheKey);
        if (cachedPool) {
            const parsed = JSON.parse(cachedPool);
            masterPool = parsed.pool;
            nextPoolStartVal = parsed.nextPoolStartVal;
            nextPoolStartIsbn = parsed.nextPoolStartIsbn;
        }
    }

    if (masterPool.length === 0) {
        let baseQuery = `
            SELECT b.isbn, b.title, b.author, b.cover_image, b.genres, b.published_year, 
                   bs.average_rating, bs.base_feed_score
            FROM books b
            INNER JOIN book_stats bs ON b.isbn = bs.isbn
        `;

        const conditions = [];
        const params = [];
        let vIdx = 1;

        if (isSafeMode) {
            conditions.push(`b.is_adult = false`);
        }

        if (genre) {
            conditions.push(`b.genres && $${vIdx}::text[]`);
            params.push(genre.split(','));
            vIdx++;
        }

        if (poolStartVal && poolStartIsbn) {
            conditions.push(`(bs.base_feed_score, b.isbn) < ($${vIdx}, $${vIdx + 1})`);
            params.push(parseFloat(poolStartVal), poolStartIsbn);
            vIdx += 2;
        }

        if (conditions.length > 0) {
            baseQuery += ` WHERE ` + conditions.join(' AND ');
        }

        baseQuery += ` ORDER BY bs.base_feed_score DESC, b.isbn DESC LIMIT ${CANDIDATE_POOL_SIZE}`;

        const dbResult = await pool.query(baseQuery, params);

        if (dbResult.rows.length > 0) {
            const lastDbBook = dbResult.rows[dbResult.rows.length - 1];
            nextPoolStartVal = lastDbBook.base_feed_score;
            nextPoolStartIsbn = lastDbBook.isbn;

            masterPool = dbResult.rows.map(book => {
                const entropy = seededRandom(bucketId, book.isbn) * 0.10;
                return { ...book, final_score: Number(book.base_feed_score) + entropy };
            });

            masterPool.sort((a, b) => b.final_score - a.final_score);

            if (shuffle !== 'true') {
                await redisConnection.set(cacheKey, JSON.stringify({
                    pool: masterPool,
                    nextPoolStartVal,
                    nextPoolStartIsbn
                }), 'EX', 180);
            }
        }
    }

    const responseBooks = masterPool.slice(offset, offset + limit);
    
    let nextCursor = null;
    let hasMore = true;

    if (responseBooks.length > 0) {
        let nextOffset = offset + limit;
        if (masterPool.length < CANDIDATE_POOL_SIZE && nextOffset >= masterPool.length) {
            hasMore = false;
        } else {
            if (nextOffset >= CANDIDATE_POOL_SIZE) {
                nextCursor = { offset: 0, poolStartVal: nextPoolStartVal, poolStartIsbn: nextPoolStartIsbn };
            } else {
                nextCursor = { offset: nextOffset, poolStartVal, poolStartIsbn };
            }
        }
    } else {
        hasMore = false;
    }

    if (genre || shuffle === 'true') {
        trackEvent(userId, 'feed_filter_used', { genre, sort: 'discovery', shuffle }).catch(console.error);
    }

    console.timeEnd(`[Feed:${requestId}] total`);
    return res.status(200).json({ books: responseBooks, nextCursor, hasMore, totalBooks: null });
};

const getStandardFeed = async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const { genre, sort, cursorVal, cursorIsbn, safe_mode } = req.query;
    
    const isSafeMode = safe_mode === 'true'; 

    let baseQuery = `
        SELECT b.isbn, b.title, b.author, b.cover_image, b.genres, b.published_year, 
               COALESCE(bs.average_rating, 0) AS average_rating
        FROM books b 
        LEFT JOIN book_stats bs ON b.isbn = bs.isbn
    `;

    const conditions = [];
    const values = [];
    let vIdx = 1;

    if (isSafeMode) {
        conditions.push(`b.is_adult = false`);
    }

    if (genre) {
        conditions.push(`b.genres && $${vIdx}::text[]`);
        values.push(genre.split(','));
        vIdx++;
    }

    if (cursorVal && cursorIsbn) {
        let op = '<'; 
        let col = 'b.published_year';

        if (sort === 'oldest') { op = '>'; col = 'b.published_year'; }
        else if (sort === 'title_a_z') { op = '>'; col = 'b.title'; }
        else if (sort === 'title_z_a') { op = '<'; col = 'b.title'; }
        else if (sort === 'top_rated') { col = 'bs.average_rating'; }

        conditions.push(`(${col}, b.isbn) ${op} ($${vIdx}, $${vIdx + 1})`);
        
        const parsedCursorVal = sort.includes('title') ? cursorVal : parseFloat(cursorVal);
        values.push(parsedCursorVal, cursorIsbn);
        vIdx += 2;
    }

    if (conditions.length > 0) {
        baseQuery += ` WHERE ` + conditions.join(' AND ');
    }

    switch (sort) {
        case 'oldest': baseQuery += ` ORDER BY b.published_year ASC, b.isbn ASC`; break;
        case 'top_rated': baseQuery += ` ORDER BY bs.average_rating DESC NULLS LAST, b.isbn DESC`; break;
        case 'title_a_z': baseQuery += ` ORDER BY b.title ASC, b.isbn ASC`; break;
        case 'title_z_a': baseQuery += ` ORDER BY b.title DESC, b.isbn DESC`; break;
        case 'newest': 
        default: baseQuery += ` ORDER BY b.published_year DESC, b.isbn DESC`; break;
    }

    baseQuery += ` LIMIT $${vIdx}`;
    values.push(limit);

    let countQuery = `SELECT COUNT(*) FROM books`;
    const countConds = [];
    const countVals = [];
    if (isSafeMode) countConds.push(`is_adult = false`);
    if (genre) { countConds.push(`genres && $1::text[]`); countVals.push(values[0]); }
    if (countConds.length > 0) countQuery += ` WHERE ` + countConds.join(' AND ');

    const countResult = await pool.query(countQuery, countVals);
    const result = await pool.query(baseQuery, values);
    const books = result.rows;

    let nextCursor = null;
    let hasMore = false;

    if (books.length === limit) {
        hasMore = true;
        const last = books[books.length - 1];
        let cv = last.published_year;
        
        if (sort === 'top_rated') cv = last.average_rating;
        else if (sort === 'title_a_z' || sort === 'title_z_a') cv = last.title;
        
        nextCursor = { cursorVal: cv, cursorIsbn: last.isbn };
    }

    return res.status(200).json({ 
        books, nextCursor, hasMore, totalBooks: parseInt(countResult.rows[0].count) 
    });
};

export const getForYouFeed = async (req, res) => {
    const requestId = crypto.randomUUID().slice(0,8);
    const userId = req?.user?.id;
    
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const poolStartVal = req.query.poolStartVal || null;
    const poolStartIsbn = req.query.poolStartIsbn || null;
    
    const isSafeMode = req.query.safe_mode === 'true';
    const cacheKey = `books:pool:foryou:${userId}:${poolStartIsbn || 'top'}:safe:${isSafeMode}`;

    let masterPool = [];
    let nextPoolStartVal = null;
    let nextPoolStartIsbn = null;

    const cachedPool = await redisConnection.get(cacheKey);
    
    if (cachedPool) {
        const parsed = JSON.parse(cachedPool);
        masterPool = parsed.pool;
        nextPoolStartVal = parsed.nextPoolStartVal;
        nextPoolStartIsbn = parsed.nextPoolStartIsbn;
    } 

    if (masterPool.length === 0) {
        const affinityQuery = `SELECT genre_weights, author_weights FROM user_affinity_weights WHERE user_id = $1`;
        const affinityResult = await pool.query(affinityQuery, [userId]);
        
        if (affinityResult.rows.length === 0 || !affinityResult.rows[0].genre_weights || Object.keys(affinityResult.rows[0].genre_weights).length === 0) {
            req.query.sort = 'discovery'; 
            return await getDiscoveryFeed(req, res, requestId);
        }

        const { genre_weights, author_weights } = affinityResult.rows[0];
        
        const topGenres = Object.entries(genre_weights)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(entry => entry[0]);

        const safeConstraint = isSafeMode ? "AND b.is_adult = false" : "";

        let baseQuery = `
            SELECT b.isbn, b.title, b.author, b.cover_image, b.genres, b.published_year, 
                   bs.average_rating, bs.base_feed_score
            FROM books b 
            INNER JOIN book_stats bs ON b.isbn = bs.isbn
            WHERE b.genres && $1::text[]
            ${safeConstraint}
            AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.isbn = b.isbn AND r.user_id = $2)
            AND NOT EXISTS (SELECT 1 FROM user_library ul WHERE ul.isbn = b.isbn AND ul.user_id = $2)
        `;

        const params = [topGenres, userId];
        let vIdx = 3;

        if (poolStartVal && poolStartIsbn) {
            baseQuery += ` AND (bs.base_feed_score, b.isbn) < ($${vIdx}, $${vIdx + 1})`;
            params.push(parseFloat(poolStartVal), poolStartIsbn);
            vIdx += 2;
        }

        baseQuery += ` ORDER BY bs.base_feed_score DESC, b.isbn DESC LIMIT ${CANDIDATE_POOL_SIZE}`;

        const dbResult = await pool.query(baseQuery, params);

        if (dbResult.rows.length > 0) {
            const lastDbBook = dbResult.rows[dbResult.rows.length - 1];
            nextPoolStartVal = lastDbBook.base_feed_score;
            nextPoolStartIsbn = lastDbBook.isbn;

            const currentYear = new Date().getFullYear();
            const dateSeed = new Date().toISOString().split('T')[0];

            masterPool = dbResult.rows.map(book => {
                let genreMatchScore = 0;
                if (book.genres && Array.isArray(book.genres)) {
                    book.genres.forEach(g => { if (genre_weights[g]) genreMatchScore += genre_weights[g]; });
                }
                
                const authorMatchScore = (book.author && author_weights[book.author]) ? author_weights[book.author] : 0;
                const pScore = (genreMatchScore * 0.7) + (authorMatchScore * 0.3);
                const age = Math.max(0, currentYear - (book.published_year || currentYear));
                const freshnessScore = Math.exp(-0.138 * age); 
                const entropy = seededRandom(`${userId}-${dateSeed}`, book.isbn) * 0.10; 

                const final_score = (pScore * 0.50) + (Number(book.base_feed_score) * 0.40) + (freshnessScore * 0.10) + entropy;
                return { ...book, final_score };
            });

            masterPool.sort((a, b) => b.final_score - a.final_score);
            await redisConnection.set(cacheKey, JSON.stringify({ pool: masterPool, nextPoolStartVal, nextPoolStartIsbn }), 'EX', 300);
        }
    }

    const responseBooks = masterPool.slice(offset, offset + limit);
    
    let nextCursor = null;
    let hasMore = true;

    if (responseBooks.length > 0) {
        let nextOffset = offset + limit;
        if (masterPool.length < CANDIDATE_POOL_SIZE && nextOffset >= masterPool.length) {
            hasMore = false;
        } else {
            if (nextOffset >= CANDIDATE_POOL_SIZE) {
                nextCursor = { offset: 0, poolStartVal: nextPoolStartVal, poolStartIsbn: nextPoolStartIsbn };
            } else {
                nextCursor = { offset: nextOffset, poolStartVal, poolStartIsbn };
            }
        }
    } else {
        hasMore = false;
    }

    return res.status(200).json({ books: responseBooks, nextCursor, hasMore, totalBooks: null });
};

export const getTrendingBooks = async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    
    const isSafeMode = req.query.safe_mode === 'true';
    const cacheKey = `feed:trending:safe:${isSafeMode}`;

    try {
        const cachedTrending = await redisConnection.get(cacheKey);
        
        if (cachedTrending) {
            const parsedBooks = JSON.parse(cachedTrending);
            return res.status(200).json({ success: true, books: parsedBooks.slice(0, limit) });
        }

        const safeFilter = isSafeMode ? "WHERE b.is_adult = false" : "";

        const query = `
            SELECT b.isbn, b.title, b.author, b.genres, b.cover_image, b.published_year, 
                   bs.average_rating, bs.trending_score 
            FROM books b JOIN book_stats bs ON b.isbn = bs.isbn
            ${safeFilter}
            ORDER BY bs.trending_score DESC NULLS LAST LIMIT 50 
        `;

        const trendingResult = await pool.query(query);

        if (trendingResult.rows.length > 0) {
            await redisConnection.set(cacheKey, JSON.stringify(trendingResult.rows), 'EX', 300);
        }

        return res.status(200).json({ success: true, books: trendingResult.rows.slice(0, limit) });
    } catch (error) {
        console.error("[Trending] Error:", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const autoCompleteBooks = async (req, res) => {
    try {
        const { query, safe_mode } = req.query;
        if (!query || query.length < 2) return res.status(200).json([]);
        
        const searchTerm = query.toLowerCase().trim();
        
        const activeIndex = safe_mode === 'true' ? safeFuseIndex : allFuseIndex;

        if (!activeIndex) return res.status(200).json([]);

        const results = activeIndex.search(searchTerm, { limit: 12 });
        return res.status(200).json(results.map(result => result.item));
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const searchBooks = async (req, res) => {
    try {
        const { query, cursorYear, cursorIsbn, limit = 20, safe_mode } = req.query;
        if (!query) return res.status(400).json({ success: false, message: 'Search query required' });
        
        const searchTerm = query.toLowerCase().trim();
        const isSafeMode = safe_mode === 'true';

        let sql = `
            SELECT isbn, title, author, cover_image, published_year, genres 
            FROM books 
            WHERE (search_text % $1 OR search_text ILIKE $2)
        `;
        let values = [searchTerm, `%${searchTerm}%`];
        let valIdx = 3;

        if (isSafeMode) {
            sql += ` AND is_adult = false`;
        }

        if (cursorYear && cursorIsbn) {
            sql += ` AND (published_year, isbn) < ($${valIdx}, $${valIdx+1})`;
            values.push(cursorYear, cursorIsbn);
            valIdx += 2;
        }

        sql += ` ORDER BY published_year DESC, isbn DESC LIMIT $${valIdx}`;
        values.push(parseInt(limit, 10));

        const result = await pool.query(sql, values);
        const books = result.rows;

        let nextCursor = null;
        if (books.length === parseInt(limit, 10)) {
            const lastBook = books[books.length - 1];
            nextCursor = { cursorYear: lastBook.published_year, cursorIsbn: lastBook.isbn };
        }

        if (books.length > 0 && req.user) {
            trackEvent(req.user.id, 'search', { query }).catch(console.error);
        }

        return res.status(200).json({ books, nextCursor });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const getBookByIsbn = async(req,res)=>{
    try {
        const {isbn} = req.params;
        const cleanIsbn = isbn.replace(/-/g, '');
        const sql = "SELECT b.*, COALESCE(ROUND(AVG(r.rating), 2), 0) AS average_rating, COUNT(r.id) AS total_reviews FROM books b LEFT JOIN ratings r ON b.isbn = r.isbn WHERE REPLACE(b.isbn, '-', '') = $1 GROUP BY b.isbn";
        const result = await pool.query(sql, [cleanIsbn]);

        if(result.rows.length === 0) return res.status(404).json({success:false,message:'Book not found'});
        
        if (req.user) trackEvent(req.user.id, 'book_view', {isbn: cleanIsbn}).catch(console.error);
        return res.status(200).json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({success:false,message:'Internal server error'});
    }
}


export const getSimilarBooks = async (req, res) => {
    const { isbn } = req.params;
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    const isSafeMode = req.query.safe_mode === 'true';

    const userId = req.user?.id || 0;
    const bucketId = getCohortBucket(userId);

    try {
        const cacheKey = `similar_books:${isbn}`;
        let matchesPool = [];

        const cachedData = await redisConnection.get(cacheKey);

        if (cachedData) {
            matchesPool = JSON.parse(cachedData);
        } else {
            const query = `
                SELECT
                    b.isbn,
                    b.title,
                    b.author,
                    b.cover_image,
                    b.genres,
                    b.published_year,
                    b.is_adult,
                    bs.average_rating,
                    bsim.similarity_score
                FROM book_similarities bsim
                JOIN books b
                    ON bsim.similar_isbn = b.isbn
                LEFT JOIN book_stats bs
                    ON b.isbn = bs.isbn
                WHERE bsim.isbn = $1
                ORDER BY bsim.similarity_score DESC
            `;

            const { rows } = await pool.query(query, [isbn]);

            matchesPool = rows;

            if (matchesPool.length) {
                await redisConnection.setex(
                    cacheKey,
                    86400,
                    JSON.stringify(matchesPool)
                );
            }
        }

        if (isSafeMode) {
            matchesPool = matchesPool.filter(
                (book) => !book.is_adult
            );
        }

        matchesPool.sort((a, b) => {
            if (a.similarity_score !== b.similarity_score) {
                return b.similarity_score - a.similarity_score;
            }

            const seedA = seededRandom(bucketId, a.isbn);
            const seedB = seededRandom(bucketId, b.isbn);

            return seedB - seedA;
        });

        return res.status(200).json({
            success: true,
            books: matchesPool.slice(0, limit)
        });
    } catch (error) {
        console.error(
            '[Books] Failed to fetch similar books:',
            error
        );

        return res.status(500).json({
            success: false,
            message: 'Failed to fetch similar books'
        });
    }
};