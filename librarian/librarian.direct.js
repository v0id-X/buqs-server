
import {
    executeLibrarianTool
} from './tool-executor.js';

import {
    getRequestedLimit,
    containsAny,
    asksForAllRatings,
    asksForLastFinishedBook,
    asksForRating,
    asksForProfile,
    asksForTrending,
    asksForRecommendation,
    asksForPersonalizedRecommendation,
    asksForNotes,
    asksForNoteAboutReference,
    asksForBookReference,
    isSimilarBookRequest,
    isBookInformationRequest,
    isLastReadReference,
    isAuthorBookRequest,
    isAuthorReferenceRequest,
    extractAuthorFollowUp,
    asksForHighestRated,
    extractCatalogRatingRequest,
    asksForRatingAmongCurrentResults,
    asksForMoreResults,
    extractRecommendationGenres,
    isGenreRecommendationRequest,
    isStandaloneBookTitle,
    normalizeTitle,
    extractTasteBookTitle,
    extractISBN,
    extractBookTitleFromMessage,
    extractAuthorFromMessage,
    extractNoteSearch
} from './librarian.parsers.js';

import {
    extractBook,
    extractBooks
} from './librarian.book-utils.js';

import {
    saveBookReference,
    saveAuthorReference,
    saveGenreRecommendationContext,
    saveRecommendationContext,
    createDisambiguationResponse
} from './librarian.reference.js';

const getLastReadBook = (history) => {
    const books =
        extractBooks(history);

    return (
        books.find(
            (book) =>
                book.user_library_status ===
                    'finished' ||
                book.user_library_status ===
                    'read'
        ) ||
        books[0] ||
        null
    );
};

export const executeDeterministicBookLookup =
    async ({
        userId,
        message,
        conversationId,
        context,
        isSafeMode
    }) => {
        const isbn =
            extractISBN(message);

        if (isbn) {
            const result =
                await executeLibrarianTool(
                    'get_book',
                    {
                        isbn
                    },
                    userId,
                    isSafeMode
                );

            const book =
                extractBook(result);

            if (book) {
                const updatedContext =
                    await saveBookReference(
                        conversationId,
                        context,
                        book
                    );

                return {
                    handled: true,
                    context:
                        updatedContext,
                    results: [
                        {
                            tool: 'get_book',
                            data: result
                        }
                    ]
                };
            }

            return {
                handled: true,
                context,
                results: [
                    {
                        tool: 'get_book',
                        data: result
                    }
                ]
            };
        }

        if (isSimilarBookRequest(message)) {
            let sourceBook =
                context?.lastReferencedBook ||
                null;

            if (!sourceBook?.isbn && isLastReadReference(message)) {
                const history =
                    await executeLibrarianTool(
                        'get_reading_history',
                        { limit: 10 },
                        userId,
                        isSafeMode
                    );

                sourceBook =
                    getLastReadBook(history);

                if (sourceBook) {
                    context =
                        await saveBookReference(
                            conversationId,
                            context,
                            sourceBook
                        );
                }
            }

            if (sourceBook?.isbn) {
                const limit =
                    getRequestedLimit(message, 5);

                const result =
                    await executeLibrarianTool(
                        'get_similar_books',
                        {
                            isbn:
                                sourceBook.isbn,
                            limit
                        },
                        userId,
                        isSafeMode
                    );

                return {
                    handled: true,
                    context,
                    results: [
                        {
                            tool:
                                'get_similar_books',
                            data: result,
                            sourceBook
                        }
                    ]
                };
            }
        }

        const tasteTitle =
            extractTasteBookTitle(message);

        if (tasteTitle) {
            const searchResult =
                await executeLibrarianTool(
                    'search_books',
                    {
                        query: tasteTitle,
                        limit: 10
                    },
                    userId,
                    isSafeMode
                );

            const books =
                extractBooks(searchResult);

            const book =
                books.find(
                    (item) =>
                        normalizeTitle(item.title) ===
                        normalizeTitle(tasteTitle)
                ) ||
                (books.length === 1
                    ? books[0]
                    : null);

            if (!book) {
                return {
                    handled: true,
                    context,
                    results: [
                        {
                            tool: 'search_books',
                            data: searchResult,
                            query: tasteTitle
                        }
                    ]
                };
            }

            context =
                await saveBookReference(
                    conversationId,
                    context,
                    book
                );

            const profile =
                await executeLibrarianTool(
                    'get_user_profile',
                    {},
                    userId,
                    isSafeMode
                );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool: 'book_taste_check',
                        data: {
                            book,
                            profile
                        }
                    }
                ]
            };
        }

        if (
            (
                isBookInformationRequest(message) ||
                isStandaloneBookTitle(message)
            ) &&
            !asksForNotes(message) &&
            !asksForNoteAboutReference(message) &&
            !asksForRecommendation(
                message
            )
        ) {
            const title =
                extractBookTitleFromMessage(message) ||
                (isStandaloneBookTitle(message)
                    ? message.trim()
                    : null);

            if (title) {
                const result =
                    await executeLibrarianTool(
                        'search_books',
                        {
                            query: title,
                            limit: 10
                        },
                        userId,
                        isSafeMode
                    );

                const books =
                    extractBooks(result);

                const disambiguation =
                    createDisambiguationResponse(
                        books
                    );

                const exactMatches =
                    books.filter(
                        (book) =>
                            normalizeTitle(book.title) ===
                            normalizeTitle(title)
                    );

                const exactBook =
                    exactMatches.length === 1
                        ? exactMatches[0]
                        : null;

                if (disambiguation) {
                    return {
                        handled: true,
                        context,
                        disambiguation,
                        results: []
                    };
                }

                if (books.length === 1 || exactBook) {
                    const selectedBook =
                        exactBook || books[0];

                    const updatedContext =
                        await saveBookReference(
                            conversationId,
                            context,
                            selectedBook
                        );

                    return {
                        handled: true,
                        context:
                            updatedContext,
                        results: [
                            {
                                tool:
                                    'get_book',
                                data:
                                    selectedBook
                            }
                        ]
                    };
                }

                return {
                    handled: true,
                    context,
                    results: [
                        {
                            tool:
                                'search_books',
                            data: result,
                            query: title
                        }
                    ]
                };
            }
        }

        return {
            handled: false,
            context,
            results: []
        };
    };

const executePersonalizedRecommendation =
    async ({
        userId,
        message,
        isSafeMode,
        excludedIsbns = []
    }) => {
        const limit =
            getRequestedLimit(
                message,
                5
            );

        const ratings =
            await executeLibrarianTool(
                'get_user_ratings',
                {
                    limit: 20
                },
                userId,
                isSafeMode
            );

        const ratingBooks =
            Array.isArray(ratings)
                ? ratings
                : ratings?.ratings ||
                  ratings?.results ||
                  [];

        const normalizedRatings =
            ratingBooks
                .map((item) => {
                    const book =
                        extractBook(item);

                    if (!book) {
                        return null;
                    }

                    const rating =
                        Number(
                            item.rating ??
                            item.user_personal_rating ??
                            book.user_personal_rating ??
                            0
                        );

                    return {
                        book,
                        rating
                    };
                })
                .filter(Boolean)
                .sort(
                    (a, b) =>
                        b.rating -
                        a.rating
                );

        if (
            normalizedRatings.length
        ) {
            const favorite =
                normalizedRatings[0]
                    .book;

            const similar =
                await executeLibrarianTool(
                    'get_similar_books',
                    {
                        isbn:
                            favorite.isbn,
                        limit,
                        excludedIsbns
                    },
                    userId,
                    isSafeMode
                );

            const books =
                extractBooks(similar);

            if (books.length) {
                return {
                    tool:
                        'personalized_similar_books',
                    sourceBook:
                        favorite,
                    sourceReason:
                        `Based on your ${normalizedRatings[0].rating}-star rating for "${favorite.title}".`,
                    data:
                        books
                };
            }
        }

        const history =
            await executeLibrarianTool(
                'get_reading_history',
                {
                    limit: 10
                },
                userId,
                isSafeMode
            );

        const historyBooks =
            Array.isArray(history)
                ? history
                    .map(extractBook)
                    .filter(Boolean)
                : history?.history
                    ?.map(extractBook)
                    ?.filter(Boolean) ||
                  history?.readingHistory
                    ?.map(extractBook)
                    ?.filter(Boolean) ||
                  history?.results
                    ?.map(extractBook)
                    ?.filter(Boolean) ||
                  [];

        const historyBook =
            historyBooks.find(
                (book) =>
                    book.user_library_status ===
                        'finished' ||
                    book.user_library_status ===
                        'read'
            ) ||
            historyBooks[0];

        if (historyBook) {
            const similar =
                await executeLibrarianTool(
                    'get_similar_books',
                    {
                        isbn:
                            historyBook.isbn,
                        limit,
                        excludedIsbns
                    },
                    userId,
                    isSafeMode
                );

            const books =
                extractBooks(similar);

            if (books.length) {
                return {
                    tool:
                        'personalized_similar_books',
                    sourceBook:
                        historyBook,
                    sourceReason:
                        `Based on your reading history, especially "${historyBook.title}".`,
                    data:
                        books
                };
            }
        }

        const trending =
            await executeLibrarianTool(
                'get_trending_books',
                {
                    limit,
                    excludedIsbns
                },
                userId,
                isSafeMode
            );

        return {
            tool:
                'personalized_fallback_trending',
            data:
                trending
        };
    };

const sameGenres = (
    left,
    right
) => {
    const normalize = (genres) =>
        Array.isArray(genres)
            ? genres
                .map((genre) => String(genre || '').trim().toLowerCase())
                .filter(Boolean)
                .sort()
            : [];

    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
};

const getRecommendationExclusions = (
    context,
    kind,
    {
        genres = [],
        author = null,
        rating = null
    } = {}
) => {
    const previous = context?.lastRecommendation;

    if (
        previous?.kind !== kind ||
        !Array.isArray(previous.shownIsbns)
    ) {
        return [];
    }

    const sameAuthor =
        String(previous.author || '').toLowerCase() ===
        String(author || '').trim().toLowerCase();

    const sameRating =
        JSON.stringify(previous.rating || null) ===
        JSON.stringify(rating || null);

    return sameAuthor &&
        sameGenres(previous.genres, genres) &&
        sameRating
        ? previous.shownIsbns
        : [];
};

const getRecentShownIsbns = (
    context
) => {
    const recommendationIsbns = Array.isArray(
        context?.lastRecommendation?.shownIsbns
    )
        ? context.lastRecommendation.shownIsbns
        : [];

    const ratedGenreIsbns = Array.isArray(
        context?.lastGenreRecommendation?.shownIsbns
    )
        ? context.lastGenreRecommendation.shownIsbns
        : [];

    return [
        ...new Set([
            ...recommendationIsbns,
            ...ratedGenreIsbns
        ].map(String))
    ].slice(-100);
};

const getLastShownIsbns = (
    context
) => {
    const shown = context?.lastRecommendation?.shownIsbns;

    return Array.isArray(shown)
        ? [...new Set(
            shown
                .map((isbn) => String(isbn || '').trim())
                .filter(Boolean)
        )].slice(-100)
        : [];
};

const toCatalogRatingMetadata = (
    rating
) => ({
    sortDirection:
        rating?.sortDirection === 'asc'
            ? 'asc'
            : 'desc',
    minimumRating:
        rating?.minimumRating ?? null,
    minimumInclusive:
        Boolean(rating?.minimumInclusive),
    maximumRating:
        rating?.maximumRating ?? null,
    maximumInclusive:
        Boolean(rating?.maximumInclusive)
});

export const executeDirectRequest =
    async ({
        userId,
        message,
        conversationId,
        context,
        isSafeMode
    }) => {
        const requestedGenres =
            extractRecommendationGenres(message);

        const isExplicitGenreRequest =
            isGenreRecommendationRequest(message);

        const ratingRequest =
            extractCatalogRatingRequest(message);

        const explicitAuthor =
            extractAuthorFromMessage(message);

        const ratingAmongCurrentResults =
            asksForRatingAmongCurrentResults(message);

        const explicitAuthorFollowUp =
            extractAuthorFollowUp(message);

        const wantsPersonalizedRecommendation =
            asksForRecommendation(message) &&
            asksForPersonalizedRecommendation(message);

        const previousCatalogRating =
            context?.lastRecommendation?.kind ===
                'catalog_rating'
                ? context.lastRecommendation
                : null;

        const previousRecommendation =
            context?.lastRecommendation ||
            null;

        const isExplicitCatalogRatingRequest =
            ratingRequest.hasRankingIntent ||
            ratingRequest.hasThreshold;

        const continuesCatalogRating =
            asksForMoreResults(message) &&
            Boolean(previousCatalogRating);

        const currentResultIsbns =
            ratingAmongCurrentResults
                ? getLastShownIsbns(context)
                : [];

        if (
            currentResultIsbns.length ||
            isExplicitCatalogRatingRequest ||
            continuesCatalogRating
        ) {
            const activeRating =
                isExplicitCatalogRatingRequest
                    ? toCatalogRatingMetadata(ratingRequest)
                    : previousCatalogRating?.rating ||
                      toCatalogRatingMetadata(ratingRequest);

            const author =
                explicitAuthor ||
                (continuesCatalogRating
                    ? previousCatalogRating?.author
                    : ratingAmongCurrentResults
                        ? previousRecommendation?.author
                    : null);

            const genres = requestedGenres.length
                ? requestedGenres
                : continuesCatalogRating
                    ? previousCatalogRating?.genres || []
                    : ratingAmongCurrentResults
                        ? previousRecommendation?.genres || []
                    : [];

            const excludedIsbns =
                continuesCatalogRating &&
                !currentResultIsbns.length
                    ? getRecommendationExclusions(
                        context,
                        'catalog_rating',
                        {
                            genres,
                            author,
                            rating: activeRating
                        }
                    )
                    : [];

            const books =
                await executeLibrarianTool(
                    'get_catalog_books',
                    {
                        author,
                        genres,
                        ...activeRating,
                        includedIsbns:
                            currentResultIsbns.length
                                ? currentResultIsbns
                                : undefined,
                        excludedIsbns,
                        limit: getRequestedLimit(message, 10)
                    },
                    userId,
                    isSafeMode
                );

            if (author) {
                context = await saveAuthorReference(
                    conversationId,
                    context,
                    author
                );
            }

            context = await saveRecommendationContext(
                conversationId,
                context,
                {
                    kind: 'catalog_rating',
                    genres,
                    author,
                    rating: activeRating,
                    books: extractBooks(books)
                }
            );

            return {
                handled: true,
                context,
                results: [
                    {
                    tool: 'catalog_rating_books',
                    data: books,
                    author,
                    genres,
                    rating: activeRating,
                    withinCurrentResults:
                        currentResultIsbns.length > 0
                    }
                ]
            };
        }

        if (
            asksForMoreResults(message) &&
            context?.lastGenreRecommendation?.genre &&
            (
                !context?.lastRecommendation ||
                context.lastRecommendation.kind ===
                    'highest_rated_genre'
            ) &&
            (
                !requestedGenres.length ||
                requestedGenres.some(
                    (genre) =>
                        String(genre).toLowerCase() ===
                        String(
                            context.lastGenreRecommendation.genre
                        ).toLowerCase()
                )
            )
        ) {
            const genre =
                context.lastGenreRecommendation.genre;

            const books =
                await executeLibrarianTool(
                    'get_highest_rated_genre_books',
                    {
                        genre,
                        excludedIsbns:
                            context.lastGenreRecommendation.shownIsbns,
                        limit: getRequestedLimit(message, 10)
                    },
                    userId,
                    isSafeMode
                );

            context =
                await saveGenreRecommendationContext(
                    conversationId,
                    context,
                    genre,
                    books
                );

            context = await saveRecommendationContext(
                conversationId,
                context,
                {
                    kind: 'highest_rated_genre',
                    genres: [genre],
                    books: extractBooks(books)
                }
            );

            return {
                handled: true,
                context,
                results: [{
                    tool: 'highest_rated_genre_books',
                    data: books,
                    genre
                }]
            };
        }

        if (
            asksForMoreResults(message) &&
            (
                context?.lastRecommendation?.kind ===
                    'personalized' ||
                wantsPersonalizedRecommendation
            )
        ) {
            const recommendation =
                await executePersonalizedRecommendation(
                    {
                        userId,
                        message,
                        isSafeMode,
                        excludedIsbns:
                            getRecentShownIsbns(context)
                    }
                );

            context = await saveRecommendationContext(
                conversationId,
                context,
                {
                    kind: 'personalized',
                    books: extractBooks(
                        recommendation.data
                    )
                }
            );

            return {
                handled: true,
                context,
                results: [
                    recommendation
                ]
            };
        }

        const authorContinuation =
            explicitAuthorFollowUp ||
            (
                asksForMoreResults(message) &&
                context?.lastRecommendation?.kind === 'author'
                    ? context.lastRecommendation.author
                    : null
            ) ||
            (
                isAuthorReferenceRequest(message) &&
                context?.lastReferencedAuthor?.name
                    ? context.lastReferencedAuthor.name
                    : null
            );

        if (authorContinuation) {
            const exclusions = asksForMoreResults(message)
                ? getRecommendationExclusions(
                    context,
                    'author',
                    { author: authorContinuation }
                )
                : [];

            context = await saveAuthorReference(
                conversationId,
                context,
                authorContinuation
            );

            const books = await executeLibrarianTool(
                'search_books',
                {
                    query: authorContinuation,
                    limit: getRequestedLimit(message, 10),
                    authorOnly: true,
                    excludedIsbns: exclusions
                },
                userId,
                isSafeMode
            );

            context = await saveRecommendationContext(
                conversationId,
                context,
                {
                    kind: 'author',
                    author: authorContinuation,
                    books: extractBooks(books)
                }
            );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool: 'author_recommendation_books',
                        data: books,
                        author: authorContinuation
                    }
                ]
            };
        }

        if (isExplicitGenreRequest) {
            const exclusions = asksForMoreResults(message)
                ? getRecentShownIsbns(context)
                : [];

            const books = await executeLibrarianTool(
                'get_genre_books',
                {
                    genres: requestedGenres,
                    excludedIsbns: exclusions,
                    limit: getRequestedLimit(message, 5)
                },
                userId,
                isSafeMode
            );

            context = await saveRecommendationContext(
                conversationId,
                context,
                {
                    kind: 'genre',
                    genres: requestedGenres,
                    books: extractBooks(books)
                }
            );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool: 'genre_recommendation_books',
                        data: books,
                        genres: requestedGenres
                    }
                ]
            };
        }

        if (
            asksForMoreResults(message) &&
            context?.lastRecommendation?.kind === 'genre' &&
            Array.isArray(context.lastRecommendation.genres) &&
            context.lastRecommendation.genres.length
        ) {
            const genres = context.lastRecommendation.genres;

            const books = await executeLibrarianTool(
                'get_genre_books',
                {
                    genres,
                    excludedIsbns: context.lastRecommendation.shownIsbns,
                    limit: getRequestedLimit(message, 5)
                },
                userId,
                isSafeMode
            );

            context = await saveRecommendationContext(
                conversationId,
                context,
                {
                    kind: 'genre',
                    genres,
                    books: extractBooks(books)
                }
            );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool: 'genre_recommendation_books',
                        data: books,
                        genres
                    }
                ]
            };
        }

        if (
            asksForAllRatings(message)
        ) {
            const ratings =
                await executeLibrarianTool(
                    'get_user_ratings',
                    {
                        limit:
                            getRequestedLimit(
                                message,
                                20
                            )
                    },
                    userId,
                    isSafeMode
                );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool:
                            'get_user_ratings',
                        data:
                            ratings
                    }
                ]
            };
        }

        if (
            asksForLastFinishedBook(
                message
            )
        ) {
            const history =
                await executeLibrarianTool(
                    'get_reading_history',
                    {
                        limit:
                            asksForRating(
                                message
                            )
                                ? 1
                                : getRequestedLimit(
                                      message,
                                      5
                                  )
                    },
                    userId,
                    isSafeMode
                );

            const lastRead =
                getLastReadBook(history);

            if (lastRead) {
                context =
                    await saveBookReference(
                        conversationId,
                        context,
                        lastRead
                    );
            }

            return {
                handled: true,
                context,
                results: [
                    {
                        tool:
                            'get_reading_history',
                        data:
                            history
                    }
                ]
            };
        }

        if (
            asksForProfile(message)
        ) {
            const profile =
                await executeLibrarianTool(
                    'get_user_profile',
                    {},
                    userId,
                    isSafeMode
                );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool:
                            'get_user_profile',
                        data:
                            profile
                    }
                ]
            };
        }

        if (
            asksForTrending(message)
        ) {
            const trending =
                await executeLibrarianTool(
                    'get_trending_books',
                    {
                        limit:
                            getRequestedLimit(
                                message,
                                5
                            )
                    },
                    userId,
                    isSafeMode
                );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool:
                            'get_trending_books',
                        data:
                            trending
                    }
                ]
            };
        }

        if (
            asksForHighestRated(message) &&
            context?.lastReferencedAuthor?.name
        ) {
            const author =
                context.lastReferencedAuthor.name;

            const books =
                await executeLibrarianTool(
                    'search_books',
                    {
                        query: author,
                        limit: 20,
                        authorOnly: true
                    },
                    userId,
                    isSafeMode
                );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool:
                            'highest_rated_author_books',
                        data: extractBooks(books)
                            .sort(
                                (a, b) =>
                                    Number(
                                        b.average_rating || 0
                                    ) -
                                    Number(
                                        a.average_rating || 0
                                    )
                            )
                            .slice(0, 5),
                        author
                    }
                ]
            };
        }

        if (
            isAuthorReferenceRequest(message) &&
            context?.lastReferencedAuthor?.name
        ) {
            const author =
                context.lastReferencedAuthor.name;

            const books =
                await executeLibrarianTool(
                    'search_books',
                    {
                        query: author,
                        limit: getRequestedLimit(message, 10),
                        authorOnly: true
                    },
                    userId,
                isSafeMode
            );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool: 'search_books',
                        data: books,
                        author
                    }
                ]
            };
        }

        if (isAuthorBookRequest(message)) {
            const author =
                extractAuthorFromMessage(message);

            context =
                await saveAuthorReference(
                    conversationId,
                    context,
                    author
                );

            const books =
                await executeLibrarianTool(
                    'search_books',
                    {
                        query: author,
                        limit: getRequestedLimit(message, 10),
                        authorOnly: true
                    },
                    userId,
                    isSafeMode
                );

            context = await saveRecommendationContext(
                conversationId,
                context,
                {
                    kind: 'author',
                    author,
                    books: extractBooks(books)
                }
            );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool: 'search_books',
                        data: books,
                        author
                    }
                ]
            };
        }

        if (wantsPersonalizedRecommendation) {
            const excludedIsbns =
                getRecentShownIsbns(context);

            const recommendation =
                await executePersonalizedRecommendation(
                    {
                        userId,
                        message,
                        isSafeMode,
                        excludedIsbns
                    }
                );

            context = await saveRecommendationContext(
                conversationId,
                context,
                {
                    kind: 'personalized',
                    books: extractBooks(
                        recommendation.data
                    )
                }
            );

            return {
                handled: true,
                context,
                results: [
                    recommendation
                ]
            };
        }

        if (
            asksForNotes(message) ||
            asksForNoteAboutReference(
                message
            )
        ) {
            const search =
                extractNoteSearch(
                    message
                ) ||
                (
                    context
                        ?.lastReferencedBook
                        ?.title &&
                    asksForNoteAboutReference(
                        message
                    )
                        ? context
                            .lastReferencedBook
                            .title
                        : undefined
                );

            console.log(
                '[Librarian] Direct notes path:',
                { search }
            );

            const notes =
                await executeLibrarianTool(
                    'get_user_notes',
                    {
                        search,
                        limit: 20
                    },
                    userId,
                    isSafeMode
                );

            return {
                handled: true,
                context,
                results: [
                    {
                        tool:
                            'get_user_notes',
                        data:
                            notes
                    }
                ]
            };
        }

        if (
            context
                ?.lastReferencedBook
                ?.isbn &&
            asksForBookReference(
                message
            )
        ) {
            const book =
                await executeLibrarianTool(
                    'get_book',
                    {
                        isbn:
                            context
                                .lastReferencedBook
                                .isbn
                    },
                    userId,
                    isSafeMode
                );

            const extracted =
                extractBook(book);

            if (extracted) {
                context =
                    await saveBookReference(
                        conversationId,
                        context,
                        extracted
                    );
            }

            return {
                handled: true,
                context,
                results: [
                    {
                        tool:
                            'get_book',
                        data:
                            book
                    }
                ]
            };
        }

        return {
            handled: false,
            context,
            results: []
        };
    };
