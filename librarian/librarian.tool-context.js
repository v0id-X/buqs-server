
import {
    extractBook,
    extractBooks
} from './librarian.book-utils.js';

import {
    saveBookReference,
    saveAuthorReference,
    saveRecommendationContext
} from './librarian.reference.js';

export const updateContextFromToolResult =
    async ({
        conversationId,
        context,
        toolName,
        data,
        toolArgs = {}
    }) => {
        let updatedContext =
            context || {};

        if (
            toolName ===
            'get_book'
        ) {
            const book =
                extractBook(data);

            if (book) {
                updatedContext =
                    await saveBookReference(
                        conversationId,
                        updatedContext,
                        book
                    );
            }
        }

        if (
            toolName ===
            'get_reading_history'
        ) {
            const books =
                extractBooks(data);

            const lastRead =
                books.find(
                    (book) =>
                        book.user_library_status ===
                            'finished' ||
                        book.user_library_status ===
                            'read'
                ) ||
                books[0];

            if (lastRead) {
                updatedContext =
                    await saveBookReference(
                        conversationId,
                        updatedContext,
                        lastRead
                    );
            }
        }

        if (
            toolName ===
            'get_similar_books'
        ) {
            const books =
                extractBooks(data);

            if (
                books.length === 1
            ) {
                updatedContext =
                    await saveBookReference(
                        conversationId,
                        updatedContext,
                        books[0]
                    );
            }
        }

        if (
            toolName ===
            'search_books'
        ) {
            const books =
                extractBooks(data);

            if (
                books.length === 1
            ) {
                updatedContext =
                    await saveBookReference(
                        conversationId,
                        updatedContext,
                        books[0]
                    );
            }

            if (books[0]?.author) {
                updatedContext =
                    await saveAuthorReference(
                        conversationId,
                        updatedContext,
                        books[0].author
                    );
            }
        }

        if (
            toolName ===
            'get_catalog_books'
        ) {
            const books = extractBooks(data);

            updatedContext =
                await saveRecommendationContext(
                    conversationId,
                    updatedContext,
                    {
                        kind: 'catalog_rating',
                        author: toolArgs.author || null,
                        genres: Array.isArray(toolArgs.genres)
                            ? toolArgs.genres
                            : [],
                        rating: {
                            sortDirection:
                                toolArgs.sortDirection === 'asc'
                                    ? 'asc'
                                    : 'desc',
                            minimumRating:
                                toolArgs.minimumRating ?? null,
                            minimumInclusive:
                                Boolean(toolArgs.minimumInclusive),
                            maximumRating:
                                toolArgs.maximumRating ?? null,
                            maximumInclusive:
                                Boolean(toolArgs.maximumInclusive)
                        },
                        books
                    }
                );

            if (toolArgs.author) {
                updatedContext =
                    await saveAuthorReference(
                        conversationId,
                        updatedContext,
                        toolArgs.author
                    );
            }
        }

        return updatedContext;
    };
