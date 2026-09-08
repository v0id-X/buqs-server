export const normalizeTitle = (title) =>
    String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

export const normalizeMessage = (message) =>
    String(message || '')
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        .trim();

export const getRequestedLimit = (
    message,
    fallback = 5
) => {
    const match = String(message || '').match(
        /\b(\d+)\b/
    );

    if (!match) {
        return fallback;
    }

    return Math.min(
        Math.max(Number(match[1]), 1),
        20
    );
};

export const containsAny = (
    message,
    values
) => {
    const normalized =
        String(message || '').toLowerCase();

    return values.some((value) =>
        normalized.includes(
            String(value).toLowerCase()
        )
    );
};

export const extractISBN = (message) => {
    const match = String(message || '').match(
        /\b(?:isbn(?:-10|-13)?[\s:]*)?(\d{9}[\dX]|\d{13})\b/i
    );

    return match
        ? match[1]
        : null;
};

export const extractNoteSearch = (
    message
) => {
    const patterns = [
        /notes?\s+about\s+(?:the\s+book\s+)?["\u201c]?(.+?)["\u201d']?[.!?]?$/i,
        /do\s+i\s+have\s+(?:any\s+|a\s+)?notes?\s+about\s+(?:the\s+book\s+)?["\u201c]?(.+?)["\u201d']?[.!?]?$/i,
        /is\s+there\s+(?:a\s+)?note\s+about\s+(?:the\s+book\s+)?["\u201c]?(.+?)["\u201d']?[.!?]?$/i,
        /show\s+me\s+(?:my\s+)?notes?\s+about\s+(?:the\s+book\s+)?["\u201c]?(.+?)["\u201d']?[.!?]?$/i
    ];

    for (const pattern of patterns) {
        const match =
            String(message || '').match(
                pattern
            );

        if (match?.[1]) {
            return match[1]
                .replace(
                    /^["\u201c\u201d']|["\u201c\u201d']$/g,
                    ''
                )
                .trim();
        }
    }

    return null;
};

export const asksForNotes = (
    message
) =>
    containsAny(message, [
        'my notes',
        'show my note',
        'show the note',
        'tell me about my notes',
        'tell me about the notes',
        'what did i write',
        'notes about',
        'do i have a note',
        'do i have any notes',
        'is there a note',
        'is there any note'
    ]);

export const asksForAllRatings = (
    message
) =>
    containsAny(message, [
        'my ratings',
        'all my ratings',
        'books i rated',
        'books that i rated',
        'what books did i rate',
        'what have i rated',
        'show my ratings',
        'show me my ratings',
        'my rated books'
    ]);

export const asksForLastFinishedBook = (
    message
) =>
    containsAny(message, [
        'last finished book',
        'last book i finished',
        'book i last finished',
        'most recently finished book',
        'latest finished book',
        'what did i finish last',
        'what was the last book i finished'
    ]);

export const asksForReadingHistory = (
    message
) =>
    containsAny(message, [
        'my reading history',
        'reading history',
        'what have i read',
        'books i have read',
        'books i read',
        'what did i read',
        'my last book',
        'my latest read',
        'my last read'
    ]) || asksForLastFinishedBook(message);

export const asksForProfile = (
    message
) =>
    containsAny(message, [
        'my profile',
        'my preferences',
        'my reading profile',
        'what do you know about me',
        'what are my preferences',
        'my genres',
        'my favorite genres',
        'my favourite genres',
        'my favorite authors',
        'my favourite authors'
    ]);

export const asksForTrending = (
    message
) =>
    containsAny(message, [
        'trending',
        'popular right now',
        'popular books',
        'what is popular',
        'what are popular'
    ]);

export const asksForLibraryStatus = (
    message
) =>
    containsAny(message, [
        'my library',
        'my wishlist',
        'my shelves',
        'my bookshelf',
        'my shelf',
        'books in my library',
        'what is in my library',
        'my to-read',
        'my reading list'
    ]);

export const isFollowUpRequest = (message) => {
    const value = String(message || '').toLowerCase().trim();

    return (
        /\b(?:something else|anything else|some other|other books?|different books?|different ones?|show(?:\s+me)? more|more books?|more by|other by|another by|not these|not those|next(?:\s+books?|\s+ones?)?)\b/i.test(value) ||
        (
            /\b(?:highest|lowest|best|worst|rating|rated)\b/i.test(value) &&
            /\b(?:among|of)\s+(?:these|those|them|the\s+(?:last\s+)?(?:books?|results?|recommendations?))\b/i.test(value)
        )
    );
};

