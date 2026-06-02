import cron from 'node-cron';
import pool from '../db/db.js';

const calculateOptimizedCosine = (
    vec1,
    vec2,
    mag1,
    mag2,
    weightMultiplier = 1
) => {
    if (mag1 === 0 || mag2 === 0) return 0;

    let dotProduct = 0;

    for (const key in vec1) {
        if (vec2[key]) {
            dotProduct += vec1[key] * vec2[key];
        }
    }

    return (dotProduct / (mag1 * mag2)) * weightMultiplier;
};

const attachMagnitudes = (books) => {
    for (const book of books) {
        let genreMagSq = 0;
        let authorMagSq = 0;

        for (const key in book.genre_vector) {
            genreMagSq += book.genre_vector[key] ** 2;
        }

        for (const key in book.author_vector) {
            authorMagSq += book.author_vector[key] ** 2;
        }

        book.genre_magnitude = Math.sqrt(genreMagSq);
        book.author_magnitude = Math.sqrt(authorMagSq);
    }
};

export const startSimilarityCron = () => {
    console.log('[Similarity-Cron] Initialized. Scheduled daily at 03:00.');

    cron.schedule('0 3 * * *', async () => {
        const startTime = Date.now();

        console.log('\n[Similarity-Cron] Starting similarity update.');

        try {
            const { rows: newBooks } = await pool.query(`
                SELECT
                    v.isbn,
                    v.genre_vector,
                    v.author_vector,
                    b.is_adult
                FROM book_feature_vectors v
                JOIN books b ON v.isbn = b.isbn
                WHERE v.updated_at >= NOW() - INTERVAL '24 hours'
            `);

            if (!newBooks.length) {
                console.log('[Similarity-Cron] No updated books found.');
                return;
            }

            const { rows: allBooks } = await pool.query(`
                SELECT
                    v.isbn,
                    v.genre_vector,
                    v.author_vector,
                    b.is_adult
                FROM book_feature_vectors v
                JOIN books b ON v.isbn = b.isbn
            `);

            console.log(
                `[Similarity-Cron] Processing ${newBooks.length} updated books against ${allBooks.length} books.`
            );

            attachMagnitudes(newBooks);
            attachMagnitudes(allBooks);

            let totalInserts = 0;

            for (const targetBook of newBooks) {
                const matches = [];

                for (const compareBook of allBooks) {
                    if (targetBook.isbn === compareBook.isbn) continue;
                    if (targetBook.is_adult !== compareBook.is_adult) continue;

                    const genreScore = calculateOptimizedCosine(
                        targetBook.genre_vector,
                        compareBook.genre_vector,
                        targetBook.genre_magnitude,
                        compareBook.genre_magnitude
                    );

                    const authorScore = calculateOptimizedCosine(
                        targetBook.author_vector,
                        compareBook.author_vector,
                        targetBook.author_magnitude,
                        compareBook.author_magnitude,
                        2
                    );

                    const totalScore = genreScore + authorScore;

                    if (totalScore > 0) {
                        matches.push({
                            isbn: compareBook.isbn,
                            score: totalScore
                        });
                    }
                }

                matches.sort((a, b) => b.score - a.score);

                const top50 = matches.slice(0, 50);

                const batchInsertValues = top50.map(
                    (match) =>
                        `('${targetBook.isbn}', '${match.isbn}', ${match.score}, NOW())`
                );

                if (batchInsertValues.length) {
                    await pool.query(
                        `DELETE FROM book_similarities WHERE isbn = $1`,
                        [targetBook.isbn]
                    );

                    await pool.query(`
                        INSERT INTO book_similarities (
                            isbn,
                            similar_isbn,
                            similarity_score,
                            created_at
                        )
                        VALUES ${batchInsertValues.join(',')}
                    `);

                    totalInserts += batchInsertValues.length;
                }
            }

            const duration = Date.now() - startTime;

            console.log(
                `[Similarity-Cron] Updated ${totalInserts} similarity pairs in ${duration}ms.`
            );
            console.log('[Similarity-Cron] Job completed.');
        } catch (error) {
            console.error('[Similarity-Cron] Job failed:', error);
        }
    });
};