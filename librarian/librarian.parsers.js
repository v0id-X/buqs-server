
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

export const extractBookTitleFromMessage = (
    message
) => {
    const patterns = [
        /(?:i\s+(?:would\s+)?(?:like|want)|i['’]?d\s+like|can\s+i|let\s+me)\s+(?:to\s+)?(?:read|start|check\s+out|open)\s+(?:the\s+book\s+)?["“]?(.+?)["”]?[.!?]?$/i,
        /tell me (?:the )?story of\s+(?:the\s+book\s+)?["“]?(.+?)["”]?[.!?]?$/i,
        /tell me something about\s+(?:the\s+book\s+)?["“]?(.+?)["”]?[.!?]?$/i,
        /tell me about\s+(?:the\s+book\s+)?["“]?(.+?)["”]?[.!?]?$/i,
        /what can you tell me about\s+(?:the\s+book\s+)?["“]?(.+?)["”]?[.!?]?$/i,
        /information about\s+(?:the\s+book\s+)?["“]?(.+?)["”]?[.!?]?$/i,
        /details about\s+(?:the\s+book\s+)?["“]?(.+?)["”]?[.!?]?$/i,
        /details for\s+(?:the\s+book\s+)?["“]?(.+?)["”]?[.!?]?$/i
    ];

    for (const pattern of patterns) {
        const match =
            String(message || '').match(
                pattern
            );

        if (match?.[1]) {
            return match[1]
                .replace(
                    /^["“']|["”']$/g,
                    ''
                )
                .replace(
                    /\s+(?:in\s+)?(?:full\s+)?details?$/i,
                    ''
                )
                .replace(
                    /\s+by\s+[^,]+$/i,
                    ''
                )
                .trim();
        }
    }

    return null;
};

export const extractAuthorFromMessage = (
    message
) => {
    const value = String(message || '').trim();
    const patterns = [
        /\b(?:books?|novels?|works?|stories?)\s+(?:by|from|of)\s+["“]?(.+?)["”]?[.!?]?$/i,
        /\b(?:by|from)\s+["“]?(.+?)["”]?\s+(?:books?|novels?|works?|stories?)[.!?]?$/i
    ];

    for (const pattern of patterns) {
        const match = value.match(pattern);

        if (!match?.[1]) {
            continue;
        }

        const author = match[1]
            .replace(/^["“']|["”']$/g, '')
            .replace(/\s+(?:with|whose|that|which)\s+.+$/i, '')
            .replace(/\s+(?:rated?|ratings?)\s*(?:above|below|over|under|more than|less than|at least|at most|>=|<=|>|<).+$/i, '')
            .trim();

        if (author.length >= 2 && author.length <= 100) {
            return author;
        }
    }

    return null;
};

export const isAuthorBookRequest = (
    message
) => Boolean(extractAuthorFromMessage(message));

export const isAuthorReferenceRequest = (
    message
) =>
    /\b(?:(?:books?|novels?|works?|stories?)\s+by|(?:more|other|another|something\s+else)\s+(?:books?\s+)?by)\s+(?:him|her|them|that author|this author)\b/i.test(
        String(message || '')
    );

export const extractAuthorFollowUp = (
    message
) => {
    const patterns = [
        /^(?:please\s+)?(?:show(?:\s+me)?|give\s+me|suggest(?:\s+me)?|recommend)?\s*(?:some\s+)?(?:more|other|another|something\s+else)\s+(?:books?\s+)?by\s+["“]?(.+?)["”]?[.!?]?$/i,
        /^(?:please\s+)?(?:more|other|another|something\s+else)\s+(?:books?\s+)?by\s+["“]?(.+?)["”]?[.!?]?$/i
    ];

    for (const pattern of patterns) {
        const match = String(message || '').match(pattern);

        if (match?.[1]) {
            return match[1]
                .replace(/^['"“]|['"”]$/g, '')
                .replace(/\s+books?$/i, '')
                .trim();
        }
    }

    return null;
};

const GENRE_ALIASES = [
    ['science fiction', 'Science Fiction'],
    ['sci fi', 'Science Fiction'],
    ['historical fiction', 'Historical Fiction'],
    ['young adult', 'Young Adult'],
    ['mystery', 'Mystery'],
    ['horror', 'Horror'],
    ['poetry', 'Poetry'],
    ['poertry', 'Poetry'],
    ['fantasy', 'Fantasy'],
    ['fiction', 'Fiction'],
    ['romance', 'Romance'],
    ['thriller', 'Thriller'],
    ['crime', 'Crime'],
    ['adventure', 'Adventure'],
    ['biography', 'Biography'],
    ['history', 'History'],
    ['classics', 'Classics']
];

export const extractRecommendationGenres = (
    message
) => {
    const value = String(message || '').toLowerCase();
    const genres = [];
    const matchedAliases = [];

    for (const [alias, genre] of GENRE_ALIASES) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, 'i');

        const isPartOfSpecificMatch = matchedAliases.some(
            (matchedAlias) =>
                matchedAlias !== alias &&
                matchedAlias.includes(alias)
        );

        if (
            pattern.test(value) &&
            !isPartOfSpecificMatch &&
            !genres.includes(genre)
        ) {
            genres.push(genre);
            matchedAliases.push(alias);
        }
    }

    return genres;
};

export const isGenreRecommendationRequest = (
    message
) => {
    const value = String(message || '').toLowerCase();

    return /\b(?:books?|novels?|read|recommend|suggest|show|give|more|other|another)\b/.test(value) &&
        extractRecommendationGenres(value).length > 0;
};

const toRatingNumber = (value) => {
    const rating = Number(value);

    return Number.isFinite(rating) && rating >= 1 && rating <= 5
        ? rating
        : null;
};

export const extractCatalogRatingRequest = (
    message
) => {
    const value = String(message || '')
        .trim()
        .toLowerCase();

    const descending =
        /\b(?:highest|top|best|greatest)(?:\s+(?:rated|[a-z]+)){0,2}\s+(?:books?|novels?|works?|stories?)\b/.test(value) ||
        /\b(?:highest|top|best|high(?:ly)?)[-\s]*rated\b/.test(value);

    const ascending =
        /\b(?:lowest|worst|least)(?:\s+(?:rated|[a-z]+)){0,2}\s+(?:books?|novels?|works?|stories?)\b/.test(value) ||
        /\b(?:lowest|worst|least)[-\s]*rated\b/.test(value);

    const ratingLanguage =
        /\b(?:rating|ratings|rated|star|stars)\b/.test(value) ||
        descending ||
        ascending;

    let minimumRating = null;
    let minimumInclusive = false;
    let maximumRating = null;
    let maximumInclusive = false;

    const minimumMatch = value.match(
        /\b(?:rating|ratings|rated|stars?)\s*(?:of\s*)?(more than|over|above|greater than|at least|at\s+or\s+above|>=|>)\s*(\d(?:\.\d)?)/i
    );

    if (minimumMatch) {
        const operator = minimumMatch[1];
        const rating = toRatingNumber(minimumMatch[2]);

        if (rating != null) {
            minimumRating = rating;
            minimumInclusive = /at least|at\s+or\s+above|>=|\+|or more/i.test(
                String(operator || '')
            );
        }
    }

    const minimumPlusMatch = value.match(
        /\b(?:rating|ratings|rated|stars?)\s*(?:of\s*)?(\d(?:\.\d)?)\s*(\+|or more)\b/i
    ) || value.match(
        /\b(\d(?:\.\d)?)\s*(\+|or more)\s*(?:stars?|rating|rated)\b/i
    );

    if (minimumRating == null && minimumPlusMatch) {
        const rating = toRatingNumber(minimumPlusMatch[1]);

        if (rating != null) {
            minimumRating = rating;
            minimumInclusive = true;
        }
    }

    const maximumMatch = value.match(
        /\b(?:rating|ratings|rated|stars?)\s*(?:of\s*)?(less than|under|below|fewer than|at most|at\s+or\s+below|<=|<)\s*(\d(?:\.\d)?)/i
    );

    if (maximumMatch) {
        const rating = toRatingNumber(maximumMatch[2]);

        if (rating != null) {
            maximumRating = rating;
            maximumInclusive = /at most|at\s+or\s+below|<=/i.test(
                maximumMatch[1]
            );
        }
    }

    const maximumPhraseMatch = value.match(
        /\b(?:rating|ratings|rated|stars?)\s*(?:of\s*)?(\d(?:\.\d)?)\s*(or less|or below)\b/i
    );

    if (maximumRating == null && maximumPhraseMatch) {
        const rating = toRatingNumber(maximumPhraseMatch[1]);

        if (rating != null) {
            maximumRating = rating;
            maximumInclusive = true;
        }
    }

    return {
        hasRatingIntent:
            ratingLanguage ||
            minimumRating != null ||
            maximumRating != null,
        hasRankingIntent:
            descending ||
            ascending,
        hasThreshold:
            minimumRating != null ||
            maximumRating != null,
        sortDirection: ascending
            ? 'asc'
            : 'desc',
        minimumRating,
        minimumInclusive,
        maximumRating,
        maximumInclusive
    };
};

export const asksForHighestRated = (
    message
) => {
    const rating = extractCatalogRatingRequest(message);

    return rating.hasRatingIntent &&
        rating.sortDirection === 'desc';
};

export const asksForRatingAmongCurrentResults = (
    message
) => {
    const value = String(message || '').toLowerCase();
    const rating = extractCatalogRatingRequest(value);

    return rating.hasRatingIntent &&
        /\b(?:among|of)\s+(?:these|those|them|the\s+(?:last\s+)?(?:books?|results?|recommendations?))\b/.test(value);
};

export const extractRatedGenre = (message) => {
    const rating = extractCatalogRatingRequest(message);
    const genres = extractRecommendationGenres(message);

    if (rating.hasRatingIntent && genres.length === 1) {
        return genres[0];
    }

    const match = String(message || '').match(
        /\b(?:highest|high(?:ly)?|top|best)[-\s]*rated\s+(.+?)\s+books?\b/i
    );

    return match?.[1]
        ? match[1].trim()
        : null;
};

export const asksForMoreResults = (message) => {
    const value = String(message || '').trim().toLowerCase();

    if (!value || /\b(?:tell|learn|know)\s+me\s+more\s+about\b/.test(value)) {
        return false;
    }

    return containsAny(value, [
        'something else',
        'anything else',
        'some other',
        'except these',
        'different ones',
        'more books',
        'show more',
        'show me more',
        'more by',
        'other by',
        'another by'
    ]) || /^(?:please\s+)?(?:show(?:\s+me)?|give\s+me|suggest(?:\s+me)?|recommend)?\s*(?:some\s+)?(?:more|other|another)\b/.test(value);
};

export const isLastReadReference = (
    message
) =>
    containsAny(message, [
        'my last read',
        'my latest read',
        'my last book',
        'last book i read',
        'last book i finished',
        'last finished book',
        'most recently finished book'
    ]);

export const isStandaloneBookTitle = (
    message
) => {
    const value = String(message || '').trim();

    return (
        /^(?:the|a|an)\s+[\p{L}\p{N}]/iu.test(value) &&
        value.split(/\s+/).length >= 2
    );
};

export const extractTasteBookTitle = (
    message
) => {
    const match = String(message || '').match(
        /^(?:is|would)\s+(.+?)\s+(?:according to|for|with)\s+my\s+(?:current\s+)?(?:reading\s+)?taste\??$/i
    );

    return match?.[1]
        ? match[1].trim()
        : null;
};

export const extractNoteSearch = (
    message
) => {
    const patterns = [
        /notes?\s+about\s+(?:the\s+book\s+)?["“]?(.+?)["”']?[.!?]?$/i,
        /do\s+i\s+have\s+(?:any\s+|a\s+)?notes?\s+about\s+(?:the\s+book\s+)?["“]?(.+?)["”']?[.!?]?$/i,
        /do\s+i\s+have\s+(?:any\s+)?notes?\s+about\s+(?:the\s+book\s+)?["“]?(.+?)["”']?[.!?]?$/i,
        /is\s+there\s+(?:a\s+)?note\s+about\s+(?:the\s+book\s+)?["“]?(.+?)["”']?[.!?]?$/i,
        /show\s+me\s+(?:my\s+)?notes?\s+about\s+(?:the\s+book\s+)?["“]?(.+?)["”']?[.!?]?$/i
    ];

    for (const pattern of patterns) {
        const match =
            String(message || '').match(
                pattern
            );

        if (match?.[1]) {
            return match[1]
                .replace(
                    /^["“']|["”']$/g,
                    ''
                )
                .trim();
        }
    }

    return null;
};

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

export const asksForRating = (
    message
) =>
    containsAny(message, [
        'rating',
        'rated',
        'stars'
    ]);

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

export const asksForRecommendation = (
    message
) =>
    containsAny(message, [
        'recommend',
        'recommendation',
        'recommendations',
        'what should i read',
        'what can i read',
        'suggest a book',
        'suggest books',
        'suggest me',
        'recommend me',
        'what would you suggest',
        'what books should i read',
        'what should i read next',
        'what to read next',
        'books i might like'
    ]);

export const asksForPersonalizedRecommendation = (
    message
) =>
    containsAny(message, [
        'for me',
        'based on my reading',
        'based on what i read',
        'based on my ratings',
        'based on my history',
        'based on my preferences',
        'based on my preference',
        'based on my reading preference',
        'based on my reading preferance',
        'based on my preferance',
        'based on my reading habits',
        'based on my habits',
        'my reading habits',
        'my habits',
        'personalized',
        'personalised',
        'my taste',
        'read next',
        'next read'
    ]);

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

export const asksForNoteAboutReference = (
    message
) =>
    containsAny(message, [
        'note about it',
        'notes about it',
        'note attached',
        'notes attached',
        'did i write a note',
        'did i write anything',
        'a note about it',
        'a note about that',
        'a note about this'
    ]);

export const asksForBookReference = (
    message
) =>
    containsAny(message, [
        'tell me about it',
        'tell me more about it',
        'more about it',
        'information about it',
        'details about it',
        'what about it',
        'tell me about that',
        'tell me more about that',
        'what about that book',
        'that book',
        'this book'
    ]);

export const isSimilarBookRequest = (
    message
) =>
    containsAny(message, [
        'similar to it',
        'similar to that',
        'similar books',
        'books like it',
        'books like that',
        'something similar',
        'similar ones',
        'show some more like this',
        'more like this',
        'more books like this',
        'something else like this',
        'something else from this book',
        'something else from that book',
        'more like that book'
    ]);

export const isBookInformationRequest = (
    message
) =>
    containsAny(message, [
        'i want to read',
        'i would like to read',
        "i'd like to read",
        'i want to start',
        'i would like to start',
        'check out',
        'tell me about',
        'what can you tell me about',
        'information about',
        'details about',
        'details for'
    ]);
