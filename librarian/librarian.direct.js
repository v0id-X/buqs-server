import {
    executeLibrarianTool
} from './tool-executor.js';

import {
    extractISBN,
    asksForNotes,
    asksForAllRatings,
    asksForProfile,
    asksForTrending,
    asksForLibraryStatus,
    asksForReadingHistory,
    extractNoteSearch,
    getRequestedLimit
} from './librarian.parsers.js';

import {
    saveBookReference
} from './librarian.reference.js';

export const executeFastPath = async ({
    userId,
    message,
    conversationId,
    context,
    isSafeMode
}) => {
    const isbn = extractISBN(message);

    if (isbn) {
        try {
            const data = await executeLibrarianTool(
                'get_book',
                { isbn },
                userId,
                isSafeMode
            );

            if (data?.isbn) {
                const updatedContext = await saveBookReference(
                    conversationId,
                    context,
                    data
                );

                return {
                    handled: true,
                    context: updatedContext,
                    results: [
                        {
                            tool: 'get_book',
                            data
                        }
                    ]
                };
            }
        } catch (error) {
            console.error('[Librarian FastPath] ISBN lookup failed:', error.message);
        }
    }

    if (asksForNotes(message)) {
        const search = extractNoteSearch(message);
        const limit = getRequestedLimit(message, 10);

        const data = await executeLibrarianTool(
            'get_user_notes',
            { search, limit },
            userId,
            isSafeMode
        );

        return {
            handled: true,
            context,
            results: [
                {
                    tool: 'get_user_notes',
                    data
                }
            ]
        };
    }

    if (asksForAllRatings(message)) {
        const limit = getRequestedLimit(message, 10);

        const data = await executeLibrarianTool(
            'get_user_ratings',
            { limit },
            userId,
            isSafeMode
        );

        return {
            handled: true,
            context,
            results: [
                {
                    tool: 'get_user_ratings',
                    data
                }
            ]
        };
    }

    if (asksForProfile(message)) {
        const data = await executeLibrarianTool(
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
                    tool: 'get_user_profile',
                    data
                }
            ]
        };
    }

    if (asksForTrending(message)) {
        const limit = getRequestedLimit(message, 10);

        const data = await executeLibrarianTool(
            'get_trending_books',
            { limit },
            userId,
            isSafeMode
        );

        return {
            handled: true,
            context,
            results: [
                {
                    tool: 'get_trending_books',
                    data
                }
            ]
        };
    }

    if (asksForLibraryStatus(message)) {
        let status = null;
        const normalized = String(message || '').toLowerCase();
        if (/\b(?:wishlist|to-read|to_read|reading list)\b/i.test(normalized)) {
            status = 'wishlist';
        } else if (/\b(?:currently reading|reading)\b/i.test(normalized)) {
            status = 'reading';
        } else if (/\b(?:finished|completed|read)\b/i.test(normalized)) {
            status = 'finished';
        }

        const limit = getRequestedLimit(message, 10);
        const data = await executeLibrarianTool(
            'get_user_library',
            { status, limit },
            userId,
            isSafeMode
        );

        return {
            handled: true,
            context,
            results: [
                {
                    tool: 'get_user_library',
                    data
                }
            ]
        };
    }

    if (asksForReadingHistory(message)) {
        const limit = getRequestedLimit(message, 10);
        const data = await executeLibrarianTool(
            'get_reading_history',
            { limit, status: 'finished' },
            userId,
            isSafeMode
        );

        return {
            handled: true,
            context,
            results: [
                {
                    tool: 'get_reading_history',
                    data
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
