
import {
    saveConversationContext
} from './memory.js';

import {
    normalizeTitle
} from './librarian.parsers.js';

import {
    toRecommendation
} from './librarian.book-utils.js';

export const saveBookReference =
    async (
        conversationId,
        context,
        book
    ) => {
        if (!book?.isbn) {
            return context;
        }

        const updatedContext = {
            ...(context || {}),
            lastReferencedBook: {
                isbn:
                    String(
                        book.isbn
                    ),
                title:
                    book.title ||
                    null,
                author:
                    book.author ||
                    null,
                published_year:
                    book.published_year ||
                    null,
                bookUrl:
                    book.bookUrl ||
                    `/books/${encodeURIComponent(
                        String(book.isbn)
                    )}`,
                noteUrl:
                    book.noteUrl ||
                    null
            },
            lastReferencedAuthor:
                book.author
                    ? {
                        name: String(book.author)
                    }
                    : context?.lastReferencedAuthor ||
                      null
        };

        await saveConversationContext(
            conversationId,
            updatedContext
        );

        return updatedContext;
    };

export const createDisambiguationResponse =
    (
        books
    ) => {
        if (!Array.isArray(books)) {
            return null;
        }

        const groups =
            new Map();

        for (const book of books) {
            if (
                !book?.title ||
                !book?.isbn
            ) {
                continue;
            }

            const key =
                normalizeTitle(
                    book.title
                );

            if (
                !groups.has(key)
            ) {
                groups.set(
                    key,
                    []
                );
            }

            groups
                .get(key)
                .push(book);
        }

        for (
            const [, matches]
                of groups
        ) {
            const unique =
                Array.from(
                    new Map(
                        matches.map(
                            (book) => [
                                String(
                                    book.isbn
                                ),
                                book
                            ]
                        )
                    ).values()
                );

            if (
                unique.length < 2
            ) {
                continue;
            }

            return {
                message:
                    `I found ${unique.length} books titled "${unique[0].title}". Which one do you mean?`,
                recommendations:
                    unique.map(
                        (book) =>
                            toRecommendation(
                                book,
                                [
                                    book.author
                                        ? `Author: ${book.author}`
                                        : null,
                                    book.published_year
                                        ? `Published: ${book.published_year}`
                                        : null,
                                    Array.isArray(
                                        book.genres
                                    )
                                        ? `Genres: ${book.genres.join(', ')}`
                                        : null
                                ]
                                    .filter(
                                        Boolean
                                    )
                                    .join(
                                        ' · '
                                    )
                            )
                    )
            };
        }

        return null;
    };

export const saveAuthorReference =
    async (
        conversationId,
        context,
        author
    ) => {
        const name =
            String(author || '').trim();

        if (!name) {
            return context;
        }

        const updatedContext = {
            ...(context || {}),
            lastReferencedAuthor: {
                name
            }
        };

        await saveConversationContext(
            conversationId,
            updatedContext
        );

        return updatedContext;
    };

export const saveGenreRecommendationContext =
    async (
        conversationId,
        context,
        genre,
        books
    ) => {
        const existing =
            Array.isArray(
                context?.lastGenreRecommendation?.shownIsbns
            )
                ? context.lastGenreRecommendation.shownIsbns
                : [];

        const shownIsbns = [
            ...new Set([
                ...existing,
                ...(Array.isArray(books)
                    ? books.map((book) => String(book?.isbn || ''))
                    : [])
            ].filter(Boolean))
        ].slice(-50);

        const updatedContext = {
            ...(context || {}),
            lastGenreRecommendation: {
                genre: String(genre || '').trim(),
                shownIsbns
            }
        };

        await saveConversationContext(
            conversationId,
            updatedContext
        );

        return updatedContext;
    };

export const saveRecommendationContext =
    async (
        conversationId,
        context,
        {
            kind = 'genre',
            genres = [],
            author = null,
            rating = null,
            books = []
        } = {}
    ) => {
        const normalizedGenres = Array.isArray(genres)
            ? [...new Set(
                genres
                    .map((genre) => String(genre || '').trim())
                    .filter(Boolean)
            )]
            : [];

        const normalizedRating = rating &&
            typeof rating === 'object'
            ? {
                sortDirection:
                    rating.sortDirection === 'asc'
                        ? 'asc'
                        : 'desc',
                minimumRating:
                    Number.isFinite(Number(rating.minimumRating))
                        ? Number(rating.minimumRating)
                        : null,
                minimumInclusive:
                    Boolean(rating.minimumInclusive),
                maximumRating:
                    Number.isFinite(Number(rating.maximumRating))
                        ? Number(rating.maximumRating)
                        : null,
                maximumInclusive:
                    Boolean(rating.maximumInclusive)
            }
            : null;

        const previous = context?.lastRecommendation;
        const isSameRecommendation =
            previous?.kind === kind &&
            String(previous?.author || '').toLowerCase() ===
                String(author || '').trim().toLowerCase() &&
            JSON.stringify(previous?.genres || []) ===
                JSON.stringify(normalizedGenres) &&
            JSON.stringify(previous?.rating || null) ===
                JSON.stringify(normalizedRating);

        const previousIsbns = isSameRecommendation &&
            Array.isArray(previous?.shownIsbns)
            ? previous.shownIsbns
            : [];

        const shownIsbns = [
            ...new Set([
                ...previousIsbns,
                ...(Array.isArray(books)
                    ? books.map((book) => String(book?.isbn || ''))
                    : [])
            ].filter(Boolean))
        ].slice(-100);

        const updatedContext = {
            ...(context || {}),
            lastRecommendation: {
                kind,
                genres: normalizedGenres,
                author: author ? String(author).trim() : null,
                rating: normalizedRating,
                shownIsbns
            }
        };

        await saveConversationContext(
            conversationId,
            updatedContext
        );

        return updatedContext;
    };
