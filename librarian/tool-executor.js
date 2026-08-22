
    import {
    getUserProfile,
    getReadingHistory,
    getUserRatings,
    searchBooks,
    getBook,
    getSimilarBooks,
    getForYouBooks,
    getGenreBooks,
    getHighestRatedGenreBooks,
    getTrendingBooks,
    getUserNotes
} from './tools.js';

export const executeLibrarianTool =
    async (
        name,
        args = {},
        userId,
        isSafeMode
    ) => {
        switch (name) {
            case 'get_user_profile':
                return getUserProfile(
                    userId
                );

            case 'get_reading_history':
                return getReadingHistory(
                    userId,
                    args.limit
                );

            case 'get_user_ratings':
                return getUserRatings(
                    userId,
                    args.limit
                );

            case 'search_books':
                return searchBooks(
                    userId,
                    args.query,
                    isSafeMode,
                    args.limit,
                    args.authorOnly,
                    args.excludedIsbns
                );

            case 'get_book':
                return getBook(
                    userId,
                    args.isbn,
                    isSafeMode
                );

            case 'get_similar_books':
                return getSimilarBooks(
                    userId,
                    args.isbn,
                    isSafeMode,
                    args.limit,
                    args.excludedIsbns
                );

            case 'get_for_you_books':
                return getForYouBooks(
                    userId,
                    isSafeMode,
                    args.limit,
                    args.genre,
                    args.author,
                    args.excludedIsbns,
                    args.genres
                );

            case 'get_genre_books':
                return getGenreBooks(
                    userId,
                    args.genres,
                    isSafeMode,
                    args.excludedIsbns,
                    args.limit
                );

            case 'get_trending_books':
                return getTrendingBooks(
                    userId,
                    isSafeMode,
                    args.limit,
                    args.excludedIsbns
                );

            case 'get_highest_rated_genre_books':
                return getHighestRatedGenreBooks(
                    userId,
                    args.genre,
                    isSafeMode,
                    args.excludedIsbns,
                    args.limit
                );

            case 'get_user_notes':
                return getUserNotes(
                    userId,
                    args.search,
                    args.limit
                );

            default:
                throw new Error(
                    `Unknown Librarian tool: ${name}`
                );
        }
    };
