
import pool from '../db/db.js';

import {
    redisConnection
} from '../utils/redisConnection.js';

const normalizeIsbn = (isbn) =>
    String(isbn).replace(/-/g, '');

const bookUrl = (isbn) =>
    `/books/${encodeURIComponent(
        normalizeIsbn(isbn)
    )}`;

const noteUrl = (id) =>
    `/notes/${encodeURIComponent(id)}`;

const incrementLibrarianMetric = (metric) => {
    const day = new Date()
        .toISOString()
        .slice(0, 10);

    const key =
        `metrics:librarian:${day}:${metric}`;

    const pipeline = redisConnection.multi();

    pipeline.incr(key);
    pipeline.expire(
        key,
        60 * 60 * 24 * 30
    );

    pipeline
        .exec()
        .catch((error) => {
            console.error(
                '[Librarian Metrics] Counter update failed:',
                error
            );
        });
};

const attachNotesToBooks = async (
    userId,
    books
) => {
    if (!books.length) {
        return books;
    }

    const titles = books.map(
        (book) => book.title
    );

    const result = await pool.query(
        `
        SELECT
            id,
            title
        FROM notes
        WHERE user_id = $1
          AND title = ANY($2::text[])
        ORDER BY updated_at DESC
        `,
        [
            userId,
            titles
        ]
    );

    const notesByTitle = new Map();

    for (const note of result.rows) {
        if (
            !notesByTitle.has(
                note.title
            )
        ) {
            notesByTitle.set(
                note.title,
                note
            );
        }
    }

    return books.map((book) => {
        const note =
            notesByTitle.get(
                book.title
            );

        return {
            ...book,
            isbn: normalizeIsbn(
                book.isbn
            ),
            bookUrl: bookUrl(
                book.isbn
            ),
            noteUrl: note
                ? noteUrl(note.id)
                : null
        };
    });
};

const enrichBooks = async (
    userId,
    books
) => {
    return attachNotesToBooks(
        userId,
        books
    );
};

export const getUserProfile = async (
    userId
) => {
    const userResult =
        await pool.query(
            `
            SELECT
                id,
                name,
                email,
                created_at
            FROM users
            WHERE id = $1
            `,
            [userId]
        );

    if (
        userResult.rows.length === 0
    ) {
        return {
            found: false
        };
    }

    const [
        affinityResult,
        libraryResult,
        ratingResult
    ] = await Promise.all([
        pool.query(
            `
            SELECT
                genre_weights,
                author_weights
            FROM user_affinity_weights
            WHERE user_id = $1
            `,
            [userId]
        ),

        pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                ul.status,
                ul.updated_at
            FROM user_library ul
            JOIN books b
                ON b.isbn = ul.isbn
            WHERE ul.user_id = $1
            ORDER BY
                ul.updated_at DESC
            LIMIT 10
            `,
            [userId]
        ),

        pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                r.rating
            FROM ratings r
            JOIN books b
                ON b.isbn = r.isbn
            WHERE r.user_id = $1
            ORDER BY b.title ASC
            LIMIT 10
            `,
            [userId]
        )
    ]);

    const genreWeights =
        affinityResult.rows[0]
            ?.genre_weights || {};

    const authorWeights =
        affinityResult.rows[0]
            ?.author_weights || {};

    return {
        found: true,
        user: userResult.rows[0],
        topGenres:
            Object.entries(
                genreWeights
            )
                .sort(
                    (a, b) =>
                        Number(b[1]) -
                        Number(a[1])
                )
                .slice(0, 5)
                .map(
                    ([genre]) =>
                        genre
                ),
        topAuthors:
            Object.entries(
                authorWeights
            )
                .sort(
                    (a, b) =>
                        Number(b[1]) -
                        Number(a[1])
                )
                .slice(0, 5)
                .map(
                    ([author]) =>
                        author
                ),
        recentLibrary:
            libraryResult.rows,
        ratings:
            ratingResult.rows
    };
};

export const getReadingHistory = async (
    userId,
    limit = 10
) => {
    const safeLimit = Math.min(
        Math.max(
            Number(limit) || 10,
            1
        ),
        20
    );

    const result =
        await pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                b.genres,
                b.cover_image,
                ul.status,
                ul.updated_at
            FROM user_library ul
            JOIN books b
                ON b.isbn = ul.isbn
            WHERE ul.user_id = $1
            ORDER BY
                ul.updated_at DESC
            LIMIT $2
            `,
            [
                userId,
                safeLimit
            ]
        );

    return enrichBooks(
        userId,
        result.rows
    );
};

export const getUserRatings = async (
    userId,
    limit = 10
) => {
    const safeLimit = Math.min(
        Math.max(
            Number(limit) || 10,
            1
        ),
        20
    );

    const result =
        await pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                b.genres,
                b.cover_image,
                r.rating
            FROM ratings r
            JOIN books b
                ON b.isbn = r.isbn
            WHERE r.user_id = $1
            ORDER BY b.title ASC
            LIMIT $2
            `,
            [
                userId,
                safeLimit
            ]
        );

    return enrichBooks(
        userId,
        result.rows
    );
};

export const searchBooks = async (
    userId,
    query,
    isSafeMode,
    limit = 10,
    authorOnly = false,
    excludedIsbns = []
) => {
    const cleanQuery =
        String(query)
            .replace(
                /[^\p{L}\p{N}\s'-]/gu,
                ' '
            )
            .replace(
                /\s+/g,
                ' '
            )
            .trim()
            .slice(0, 100);

    if (
        cleanQuery.length < 2
    ) {
        return [];
    }

    const safeLimit = Math.min(
        Math.max(
            Number(limit) || 10,
            1
        ),
        20
    );

    const safeExcluded = Array.isArray(excludedIsbns)
        ? excludedIsbns.map(String).slice(-100)
        : [];

    const conditions = [
        authorOnly
            ? 'b.author ILIKE $2'
            : `
        (
            b.search_text % $1
            OR
            b.search_text ILIKE $2
            OR
            similarity(b.search_text, $1) >= 0.22
            OR
            word_similarity($1, b.search_text) >= 0.25
        )
        `
    ];

    if (isSafeMode) {
        conditions.push(
            'b.is_adult = false'
        );
    }

    conditions.push(
        'NOT (b.isbn = ANY($6::text[]))'
    );

    const result =
        await pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                b.description,
                b.genres,
                b.cover_image,
                b.published_year,

                COALESCE(
                    bs.average_rating,
                    0
                ) AS average_rating,

                ul.status
                    AS user_library_status,

                r.rating
                    AS user_personal_rating

            FROM books b

            LEFT JOIN book_stats bs
                ON bs.isbn = b.isbn

            LEFT JOIN user_library ul
                ON ul.isbn = b.isbn
               AND ul.user_id = $3

            LEFT JOIN ratings r
                ON r.isbn = b.isbn
               AND r.user_id = $3

            WHERE ${conditions.join(
                ' AND '
            )}

            ORDER BY
                CASE
                    WHEN $5::boolean
                    THEN 0

                    WHEN LOWER(b.title)
                        = LOWER($1)
                    THEN 0

                    WHEN LOWER(b.title)
                        LIKE LOWER($2)
                    THEN 1

                    ELSE 2
                END,

                GREATEST(
                    similarity(b.search_text, $1),
                    word_similarity($1, b.search_text)
                ) DESC,

                b.published_year
                    DESC NULLS LAST,

                b.isbn DESC

            LIMIT $4
            `,
            [
                cleanQuery.toLowerCase(),
                `%${cleanQuery}%`,
                userId,
                safeLimit,
                authorOnly,
                safeExcluded
            ]
        );

    return enrichBooks(
        userId,
        result.rows
    );
};

export const getBook = async (
    userId,
    isbn,
    isSafeMode
) => {
    const cleanIsbn =
        normalizeIsbn(isbn);

    const conditions = [
        `
        REPLACE(
            b.isbn,
            '-',
            ''
        ) = $1
        `
    ];

    if (isSafeMode) {
        conditions.push(
            'b.is_adult = false'
        );
    }

    const result =
        await pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                b.description,
                b.genres,
                b.cover_image,
                b.published_year,
                b.is_adult,

                COALESCE(
                    bs.average_rating,
                    0
                ) AS average_rating,

                ul.status
                    AS user_library_status,

                r.rating
                    AS user_personal_rating

            FROM books b

            LEFT JOIN book_stats bs
                ON bs.isbn = b.isbn

            LEFT JOIN user_library ul
                ON ul.isbn = b.isbn
               AND ul.user_id = $2

            LEFT JOIN ratings r
                ON r.isbn = b.isbn
               AND r.user_id = $2

            WHERE ${conditions.join(
                ' AND '
            )}

            LIMIT 1
            `,
            [
                cleanIsbn,
                userId
            ]
        );

    if (
        result.rows.length === 0
    ) {
        return null;
    }

    const enriched =
        await enrichBooks(
            userId,
            result.rows
        );

    return enriched[0];
};

export const getSimilarBooks = async (
    userId,
    isbn,
    isSafeMode,
    limit = 10,
    excludedIsbns = []
) => {
    const cleanIsbn =
        normalizeIsbn(isbn);

    const safeLimit = Math.min(
        Math.max(
            Number(limit) || 10,
            1
        ),
        20
    );

    const safeExcluded = Array.isArray(excludedIsbns)
        ? excludedIsbns.map(String).slice(-100)
        : [];

    const conditions = [
        `bsim.isbn = $1`,

        `
        NOT EXISTS (
            SELECT 1
            FROM user_library ul
            WHERE ul.isbn = b.isbn
              AND ul.user_id = $2
        )
        `,

        `
        NOT EXISTS (
            SELECT 1
            FROM ratings r
            WHERE r.isbn = b.isbn
              AND r.user_id = $2
        )
        `,

        `NOT (b.isbn = ANY($4::text[]))`
    ];

    if (isSafeMode) {
        conditions.push(
            'b.is_adult = false'
        );
    }

    const result =
        await pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                b.description,
                b.genres,
                b.cover_image,
                b.published_year,
                b.is_adult,

                COALESCE(
                    bs.average_rating,
                    0
                ) AS average_rating,

                bsim.similarity_score

            FROM book_similarities bsim

            JOIN books b
                ON b.isbn =
                   bsim.similar_isbn

            LEFT JOIN book_stats bs
                ON bs.isbn = b.isbn

            WHERE ${conditions.join(
                ' AND '
            )}

            ORDER BY
                bsim.similarity_score DESC

            LIMIT $3
            `,
            [
                cleanIsbn,
                userId,
                safeLimit,
                safeExcluded
            ]
        );

    return enrichBooks(
        userId,
        result.rows
    );
};


export const getForYouBooks = async (
    userId,
    isSafeMode,
    limit = 10,
    genre = null,
    author = null,
    excludedIsbns = [],
    genres = []
) => {
    const safeLimit = Math.min(
        Math.max(
            Number(limit) || 10,
            1
        ),
        20
    );

    const affinityResult =
        await pool.query(
            `
            SELECT
                genre_weights,
                author_weights
            FROM user_affinity_weights
            WHERE user_id = $1
            `,
            [userId]
        );

    const affinity = affinityResult.rows[0] || {};

    const genreWeights = affinity.genre_weights || {};

    const authorWeights = affinity.author_weights || {};

    const requestedGenres = [
        ...(Array.isArray(genres) ? genres : []),
        ...(typeof genre === 'string' && genre.trim() ? [genre] : [])
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .filter(
            (value, index, values) =>
                values.findIndex(
                    (item) => item.toLowerCase() === value.toLowerCase()
                ) === index
        )
        .slice(0, 5);

    const hasExplicitGenre = requestedGenres.length > 0;

    const hasExplicitAuthor =
        typeof author === 'string' &&
        author.trim().length > 0;

    const safeExcluded = Array.isArray(excludedIsbns)
        ? excludedIsbns.map(String).slice(-100)
        : [];

    const conditions = [
        `NOT EXISTS (
            SELECT 1
            FROM ratings r
            WHERE r.isbn = b.isbn
              AND r.user_id = $1
        )`,

        `NOT EXISTS (
            SELECT 1
            FROM user_library ul
            WHERE ul.isbn = b.isbn
              AND ul.user_id = $1
        )`
    ];

    const params = [
        userId,
        JSON.stringify(genreWeights),
        JSON.stringify(authorWeights)
    ];

    let paramIndex = 4;

    if (hasExplicitGenre) {
        conditions.push(
            `EXISTS (
                SELECT 1
                FROM unnest(b.genres) AS g
                WHERE LOWER(g) = ANY($${paramIndex}::text[])
            )`
        );

        params.push(
            requestedGenres.map((value) => value.toLowerCase())
        );

        paramIndex++;
    }

    if (hasExplicitAuthor) {
        conditions.push(
            `LOWER(b.author) LIKE LOWER($${paramIndex})`
        );

        params.push(
            `%${author.trim()}%`
        );

        paramIndex++;
    }

    if (isSafeMode) {
        conditions.push(
            'b.is_adult = false'
        );
    }

    conditions.push(
        `NOT (b.isbn = ANY($${paramIndex}::text[]))`
    );

    params.push(safeExcluded);

    const result =
        await pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                b.description,
                b.genres,
                b.cover_image,
                b.published_year,

                COALESCE(
                    bs.average_rating,
                    0
                ) AS average_rating,

                COALESCE(
                    bs.base_feed_score,
                    0
                ) AS base_feed_score,

                (
                    SELECT
                        COALESCE(
                            SUM(
                                COALESCE(
                                    ($2::jsonb ->> g)::numeric,
                                    0
                                )
                            ),
                            0
                        )
                    FROM unnest(b.genres) AS g
                ) AS genre_affinity,

                COALESCE(
                    ($3::jsonb ->> b.author)::numeric,
                    0
                ) AS author_affinity

            FROM books b

            LEFT JOIN book_stats bs
                ON bs.isbn = b.isbn

            WHERE ${conditions.join('\nAND ')}

            ORDER BY
                (
                    (
                        SELECT
                            COALESCE(
                                SUM(
                                    COALESCE(
                                        ($2::jsonb ->> g)::numeric,
                                        0
                                    )
                                ),
                                0
                            )
                        FROM unnest(b.genres) AS g
                    ) * 0.55

                    +

                    COALESCE(
                        ($3::jsonb ->> b.author)::numeric,
                        0
                    ) * 0.30

                    +

                    LEAST(
                        COALESCE(
                            bs.base_feed_score,
                            0
                        ),
                        10
                    ) * 0.10

                    +

                    LEAST(
                        COALESCE(
                            bs.average_rating,
                            0
                        ),
                        5
                    ) * 0.05
                ) DESC,

                b.published_year
                    DESC NULLS LAST,

                b.isbn DESC

            LIMIT ${safeLimit}
            `,
            params
        );

    return enrichBooks(
        userId,
        result.rows
    );
};

export const getGenreBooks = async (
    userId,
    genres = [],
    isSafeMode,
    excludedIsbns = [],
    limit = 5
) => {
    const requestedGenres = Array.isArray(genres)
        ? genres
            .map((genre) => String(genre || '').trim())
            .filter(Boolean)
            .filter(
                (genre, index, values) =>
                    values.findIndex(
                        (value) =>
                            value.toLowerCase() === genre.toLowerCase()
                    ) === index
            )
            .slice(0, 5)
        : [];

    if (!requestedGenres.length) {
        return [];
    }

    const safeLimit = Math.min(
        Math.max(Number(limit) || 5, 1),
        20
    );

    const safeExcluded = Array.isArray(excludedIsbns)
        ? excludedIsbns.map(String).slice(-100)
        : [];

    const conditions = [
        `EXISTS (
            SELECT 1
            FROM unnest(b.genres) AS genre
            WHERE LOWER(genre) = ANY($2::text[])
        )`,
        `NOT EXISTS (
            SELECT 1
            FROM ratings r
            WHERE r.isbn = b.isbn
              AND r.user_id = $1
        )`,
        `NOT EXISTS (
            SELECT 1
            FROM user_library ul
            WHERE ul.isbn = b.isbn
              AND ul.user_id = $1
        )`,
        `NOT (b.isbn = ANY($3::text[]))`
    ];

    if (isSafeMode) {
        conditions.push('b.is_adult = false');
    }

    const result = await pool.query(
        `
        SELECT
            b.isbn,
            b.title,
            b.author,
            b.description,
            b.genres,
            b.cover_image,
            b.published_year,
            COALESCE(bs.average_rating, 0) AS average_rating,
            COALESCE(bs.base_feed_score, 0) AS base_feed_score,
            CASE
                WHEN LOWER(b.genres[1]) = ANY($2::text[])
                THEN 0
                ELSE 1
            END AS primary_genre_match
        FROM books b
        LEFT JOIN book_stats bs ON bs.isbn = b.isbn
        WHERE ${conditions.join(' AND ')}
        ORDER BY
            primary_genre_match ASC,
            COALESCE(bs.base_feed_score, 0) DESC,
            COALESCE(bs.average_rating, 0) DESC,
            b.published_year DESC NULLS LAST,
            b.isbn DESC
        LIMIT $4
        `,
        [
            userId,
            requestedGenres.map((genre) => genre.toLowerCase()),
            safeExcluded,
            safeLimit
        ]
    );

    return enrichBooks(
        userId,
        result.rows
    );
};

export const getCatalogBooks = async (
    userId,
    {
        author = null,
        genres = [],
        minimumRating = null,
        minimumInclusive = false,
        maximumRating = null,
        maximumInclusive = false,
        sortDirection = 'desc',
        includedIsbns = null,
        excludedIsbns = [],
        limit = 10
    } = {},
    isSafeMode
) => {
    const safeLimit = Math.min(
        Math.max(Number(limit) || 10, 1),
        20
    );

    const safeAuthor = String(author || '')
        .trim()
        .slice(0, 100);

    const safeGenres = Array.isArray(genres)
        ? [...new Set(
            genres
                .map((genre) => String(genre || '').trim().toLowerCase())
                .filter(Boolean)
        )].slice(0, 5)
        : [];

    const safeIncluded = Array.isArray(includedIsbns)
        ? [...new Set(
            includedIsbns
                .map((isbn) => String(isbn || '').trim())
                .filter(Boolean)
        )].slice(-100)
        : null;

    const safeExcluded = Array.isArray(excludedIsbns)
        ? [...new Set(
            excludedIsbns
                .map((isbn) => String(isbn || '').trim())
                .filter(Boolean)
        )].slice(-100)
        : [];

    if (Array.isArray(safeIncluded) && !safeIncluded.length) {
        return [];
    }

    const values = [userId];
    const addValue = (value) => {
        values.push(value);
        return `$${values.length}`;
    };

    const conditions = [];

    if (safeAuthor) {
        const authorValue = addValue(`%${safeAuthor}%`);
        conditions.push(`b.author ILIKE ${authorValue}`);
    }

    if (safeGenres.length) {
        const genresValue = addValue(safeGenres);
        conditions.push(`
            EXISTS (
                SELECT 1
                FROM unnest(b.genres) AS genre
                WHERE LOWER(genre) = ANY(${genresValue}::text[])
            )
        `);
    }

    const safeMinimum = Number(minimumRating);

    if (
        Number.isFinite(safeMinimum) &&
        safeMinimum >= 1 &&
        safeMinimum <= 5
    ) {
        const minimumValue = addValue(safeMinimum);
        conditions.push(
            `COALESCE(bs.average_rating, 0) ${minimumInclusive ? '>=' : '>'} ${minimumValue}::numeric`
        );
    }

    const safeMaximum = Number(maximumRating);

    if (
        Number.isFinite(safeMaximum) &&
        safeMaximum >= 1 &&
        safeMaximum <= 5
    ) {
        const maximumValue = addValue(safeMaximum);
        conditions.push(
            `COALESCE(bs.average_rating, 0) ${maximumInclusive ? '<=' : '<'} ${maximumValue}::numeric`
        );
    }

    if (Array.isArray(safeIncluded)) {
        const includedValue = addValue(safeIncluded);
        conditions.push(`b.isbn = ANY(${includedValue}::text[])`);
    }

    if (safeExcluded.length) {
        const excludedValue = addValue(safeExcluded);
        conditions.push(`NOT (b.isbn = ANY(${excludedValue}::text[]))`);
    }

    if (isSafeMode) {
        conditions.push('b.is_adult = false');
    }

    const direction = sortDirection === 'asc'
        ? 'ASC'
        : 'DESC';

    const limitValue = addValue(safeLimit);

    const result = await pool.query(
        `
        SELECT
            b.isbn,
            b.title,
            b.author,
            b.description,
            b.genres,
            b.cover_image,
            b.published_year,
            COALESCE(bs.average_rating, 0) AS average_rating,
            ul.status AS user_library_status,
            r.rating AS user_personal_rating
        FROM books b
        LEFT JOIN book_stats bs
            ON bs.isbn = b.isbn
        LEFT JOIN user_library ul
            ON ul.isbn = b.isbn
           AND ul.user_id = $1
        LEFT JOIN ratings r
            ON r.isbn = b.isbn
           AND r.user_id = $1
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY
            COALESCE(bs.average_rating, 0) ${direction},
            b.published_year DESC NULLS LAST,
            b.isbn DESC
        LIMIT ${limitValue}
        `,
        values
    );

    return enrichBooks(userId, result.rows);
};

export const getHighestRatedGenreBooks = async (
    userId,
    genre,
    isSafeMode,
    excludedIsbns = [],
    limit = 10
) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);
    const safeExcluded = Array.isArray(excludedIsbns)
        ? excludedIsbns.map(String).slice(0, 50)
        : [];
    const conditions = [
        `EXISTS (
            SELECT 1 FROM unnest(b.genres) AS g
            WHERE LOWER(g) = LOWER($1)
        )`
    ];

    if (isSafeMode) conditions.push('b.is_adult = false');
    // Always reference $2. PostgreSQL cannot infer its type when an empty
    // exclusion list leaves the placeholder unused on the first request.
    conditions.push(
        `NOT (b.isbn = ANY($2::text[]))`
    );

    const result = await pool.query(
        `
        SELECT
            b.isbn, b.title, b.author, b.description, b.genres,
            b.cover_image, b.published_year,
            COALESCE(bs.average_rating, 0) AS average_rating
        FROM books b
        LEFT JOIN book_stats bs ON bs.isbn = b.isbn
        WHERE ${conditions.join(' AND ')}
        ORDER BY COALESCE(bs.average_rating, 0) DESC, b.published_year DESC NULLS LAST
        LIMIT $3
        `,
        [genre, safeExcluded, safeLimit]
    );

    return enrichBooks(userId, result.rows);
};

export const getTrendingBooks = async (
    userId,
    isSafeMode,
    limit = 10,
    excludedIsbns = []
) => {
    const safeLimit = Math.min(
        Math.max(
            Number(limit) || 10,
            1
        ),
        20
    );

    const cacheKey =
        `feed:trending:safe:${Boolean(isSafeMode)}`;

    const safeExcluded = Array.isArray(excludedIsbns)
        ? excludedIsbns.map(String).slice(-100)
        : [];

    try {
        const cached = await redisConnection.get(cacheKey);

        if (cached) {
            const parsed = JSON.parse(cached);

            if (Array.isArray(parsed) && parsed.length) {
                incrementLibrarianMetric(
                    'trending_cache_hit'
                );

                return enrichBooks(
                    userId,
                    parsed
                        .filter(
                            (book) =>
                                !safeExcluded.includes(
                                    String(book?.isbn || '')
                                )
                        )
                        .slice(0, safeLimit)
                );
            }
        }
    } catch (error) {
        console.error(
            '[Librarian Tool] Trending cache read failed:',
            error
        );
    }

    incrementLibrarianMetric(
        'trending_cache_miss'
    );

    const conditions = [
        `NOT (b.isbn = ANY($2::text[]))`
    ];

    if (isSafeMode) {
        conditions.push('b.is_adult = false');
    }

    const result =
        await pool.query(
            `
            SELECT
                b.isbn,
                b.title,
                b.author,
                b.description,
                b.genres,
                b.cover_image,
                b.published_year,

                COALESCE(
                    bs.average_rating,
                    0
                ) AS average_rating,

                COALESCE(
                    bs.trending_score,
                    0
                ) AS trending_score

            FROM books b

            JOIN book_stats bs
                ON bs.isbn = b.isbn

            WHERE ${conditions.join(' AND ')}

            ORDER BY
                bs.trending_score
                    DESC NULLS LAST

            LIMIT $1
            `,
            [
                safeLimit,
                safeExcluded
            ]
        );

    try {
        if (result.rows.length) {
            await redisConnection.set(
                cacheKey,
                JSON.stringify(result.rows),
                'EX',
                1800
            );
        }
    } catch (error) {
        console.error(
            '[Librarian Tool] Trending cache write failed:',
            error
        );
    }

    return enrichBooks(
        userId,
        result.rows
    );
};

export const getUserNotes = async (
    userId,
    search = null,
    limit = 20
) => {
    console.log(
        '[Librarian Tool] get_user_notes',
        {
            search,
            limit
        }
    );

    const safeLimit = Math.min(
        Math.max(
            Number(limit) || 20,
            1
        ),
        50
    );

    let query;
    let params;

    if (
        search &&
        search.trim()
    ) {
        const searchTerm =
            search.trim();

        query = `
            SELECT
                n.id,
                n.title,
                n.content,
                n.created_at,
                n.updated_at
            FROM notes n
            WHERE n.user_id = $1
              AND (
                    n.title ILIKE '%' || $2 || '%'
                    OR n.content ILIKE '%' || $2 || '%'
              )
            ORDER BY
                n.updated_at DESC NULLS LAST
            LIMIT $3
        `;

        params = [
            userId,
            searchTerm,
            safeLimit
        ];
    } else {
        query = `
            SELECT
                n.id,
                n.title,
                n.content,
                n.created_at,
                n.updated_at
            FROM notes n
            WHERE n.user_id = $1
            ORDER BY
                n.updated_at DESC NULLS LAST
            LIMIT $2
        `;

        params = [
            userId,
            safeLimit
        ];
    }

    const { rows } =
        await pool.query(
            query,
            params
        );

    const notes =
        rows.map((note) => ({
            ...note,
            noteUrl:
                noteUrl(note.id)
        }));

    console.log(
        `[Librarian Tool] get_user_notes returned ${notes.length} results`
    );

    return notes;
};
