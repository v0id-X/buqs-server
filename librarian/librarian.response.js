
import {
    groq,
    GROQ_MODEL
} from './groqClient.js';

import {
    LLMResponseSchema
} from './schemas.js';

import {
    FINAL_SYSTEM_PROMPT,
    FINAL_MAX_COMPLETION_TOKENS,
    FINAL_RESPONSE_SCHEMA
} from './librarian.constants.js';

import {
    extractBook,
    extractBooks,
    toRecommendation,
    getNoteContent
} from './librarian.book-utils.js';

import {
    asksForLastFinishedBook
} from './librarian.parsers.js';

const createNotesResponse = (
    notes
) => {
    const list =
        Array.isArray(notes)
            ? notes
            : [];

    if (!list.length) {
        return {
            message:
                "You don't have any notes matching that request.",
            recommendations: [],
            notes: []
        };
    }

    const noteLines =
        list
            .slice(0, 10)
            .map((note) => {
                const title =
                    note.title ||
                    'Untitled note';

                const content =
                    getNoteContent(note);

                if (!content) {
                    return `"${title}"`;
                }

                return `"${title}": ${content}`;
            });

    return {
        message:
            `Here are your notes: ${noteLines.join(' | ')}`,
        recommendations: [],
        notes: list
            .slice(0, 10)
            .filter(
                (note) =>
                    note?.id != null &&
                    note?.noteUrl
            )
            .map((note) => ({
                id: note.id,
                title: note.title || 'Untitled note',
                content: getNoteContent(note),
                noteUrl: note.noteUrl
            }))
    };
};

export const buildDeterministicResponse = ({
    message,
    results,
    context
}) => {
    const result =
        results?.[0];

    if (!result) {
        return null;
    }

    const data =
        result.data;

    if (result.tool === 'highest_rated_author_books') {
        const books =
            extractBooks(data);

        return {
            message: books.length
                ? `Here are the highest-rated books by ${result.author} in the BUQS catalog:`
                : `I couldn't find rated books by ${result.author} in the BUQS catalog.`,
            recommendations: books.map((book) =>
                toRecommendation(
                    book,
                    book.average_rating != null
                        ? `Average rating: ${book.average_rating}.`
                        : 'Available in the BUQS catalog.'
                )
            )
        };
    }

    if (result.tool === 'highest_rated_genre_books') {
        const books = extractBooks(data);

        return {
            message: books.length
                ? `Here are the highest-rated ${result.genre} books in the BUQS catalog:`
                : `I couldn't find rated ${result.genre} books in the BUQS catalog.`,
            recommendations: books.map((book) =>
                toRecommendation(
                    book,
                    `Average rating: ${book.average_rating ?? 0}.`
                )
            )
        };
    }

    if (result.tool === 'genre_recommendation_books') {
        const books = extractBooks(data);
        const genres = Array.isArray(result.genres)
            ? result.genres.filter(Boolean)
            : [];
        const genreLabel = genres.length > 1
            ? genres.join(' and ')
            : genres[0] || 'selected';

        return {
            message: books.length
                ? `Here are some ${genreLabel} books from the BUQS catalog:`
                : `I couldn't find more ${genreLabel} books in the BUQS catalog.`,
            recommendations: books.map((book) =>
                toRecommendation(
                    book,
                    'Selected from the BUQS catalog.'
                )
            )
        };
    }

    if (result.tool === 'author_recommendation_books') {
        const books = extractBooks(data);

        return {
            message: books.length
                ? `Here are more books by ${result.author} in the BUQS catalog:`
                : `I couldn't find more books by ${result.author} in the BUQS catalog.`,
            recommendations: books.map((book) =>
                toRecommendation(
                    book,
                    `By ${book.author || result.author}.`
                )
            )
        };
    }

    if (result.tool === 'book_taste_check') {
        const book =
            extractBook(data?.book);

        if (!book) {
            return {
                message: "I couldn't find that book in the BUQS catalog.",
                recommendations: []
            };
        }

        const preferredGenres =
            Array.isArray(data?.profile?.topGenres)
                ? data.profile.topGenres
                : [];

        const bookGenres =
            Array.isArray(book.genres)
                ? book.genres
                : [];

        const matchingGenres =
            bookGenres.filter((genre) =>
                preferredGenres.some(
                    (preferred) =>
                        String(preferred).toLowerCase() ===
                        String(genre).toLowerCase()
                )
            );

        const isFit =
            matchingGenres.length > 0;

        return {
            message: isFit
                ? `Yes — "${book.title}" looks like a good fit for your current reading taste, especially because you enjoy ${matchingGenres.join(', ')}.`
                : preferredGenres.length
                    ? `"${book.title}" may be a change of pace. Its genres do not overlap with your strongest current preferences: ${preferredGenres.join(', ')}.`
                    : `I found "${book.title}", but you do not have enough reading-preference data yet to judge the fit.`,
            recommendations: [
                toRecommendation(
                    book,
                    isFit
                        ? `Matches your interest in ${matchingGenres.join(', ')}.`
                        : 'Compare this with your current reading preferences.'
                )
            ]
        };
    }

    if (
        result.tool ===
        'personalized_similar_books'
    ) {
        const books =
            extractBooks(data);

        if (!books.length) {
            return {
                message:
                    "I couldn't find personalized recommendations from your reading history right now.",
                recommendations: []
            };
        }

        return {
            message:
                result.sourceReason
                    ? `Based on your reading, especially "${result.sourceBook?.title}", here are some books you might enjoy:`
                    : 'Here are some books you might enjoy based on your reading history:',
            recommendations:
                books.map(
                    (book) =>
                        toRecommendation(
                            book,
                            result.sourceReason ||
                                'Recommended based on your reading history.'
                        )
                )
        };
    }

    if (
        result.tool ===
        'personalized_fallback_trending'
    ) {
        const books =
            extractBooks(data);

        if (!books.length) {
            return {
                message:
                    "I couldn't find any recommendations right now.",
                recommendations: []
            };
        }

        return {
            message:
                'I could not find enough personal reading data yet, so here are some currently trending books you could try:',
            recommendations:
                books.map(
                    (book) =>
                        toRecommendation(
                            book,
                            'Currently trending on BUQS.'
                        )
                )
        };
    }

    if (
        result.tool ===
        'get_trending_books'
    ) {
        const books =
            extractBooks(data);

        if (!books.length) {
            return {
                message:
                    "I couldn't find any trending books right now.",
                recommendations: []
            };
        }

        return {
            message:
                'Here are some books that are currently trending:',
            recommendations:
                books.map(
                    (book) =>
                        toRecommendation(
                            book,
                            'Currently trending on BUQS.'
                        )
                )
        };
    }

    if (
        result.tool ===
        'get_user_ratings'
    ) {
        const ratings =
            Array.isArray(data)
                ? data
                : data?.ratings ||
                  data?.results ||
                  [];

        if (!ratings.length) {
            return {
                message:
                    "You haven't rated any books yet.",
                recommendations: []
            };
        }

        return {
            message:
                'Here are the books you have rated:',
            recommendations:
                ratings
                    .map((rating) => {
                        const book =
                            extractBook(
                                rating
                            );

                        if (!book) {
                            return null;
                        }

                        const value =
                            rating.rating ??
                            rating.user_personal_rating ??
                            book.user_personal_rating;

                        return toRecommendation(
                            book,
                            value != null
                                ? `You rated this book ${value} stars.`
                                : 'You have rated this book.'
                        );
                    })
                    .filter(Boolean)
        };
    }

    if (
        result.tool ===
        'get_user_notes'
    ) {
        return createNotesResponse(
            data
        );
    }

    if (
        result.tool ===
        'get_reading_history'
    ) {
        const history =
            Array.isArray(data)
                ? data
                : data?.history ||
                  data?.readingHistory ||
                  data?.results ||
                  [];

        const books =
            history
                .map(extractBook)
                .filter(Boolean);

        if (!books.length) {
            return {
                message:
                    "I couldn't find any reading history.",
                recommendations: []
            };
        }

        const lastBook =
            books[0];

        const normalizedMessage =
            message.toLowerCase();

        if (
            asksForLastFinishedBook(
                message
            ) &&
            !normalizedMessage.includes(
                'last 5'
            ) &&
            !normalizedMessage.includes(
                'last five'
            )
        ) {
            return {
                message:
                    `Your last finished book was "${lastBook.title}".`,
                recommendations: []
            };
        }

        return {
            message:
                'Here are the latest books from your reading history:',
            recommendations:
                books.map(
                    (book) =>
                        toRecommendation(
                            book,
                            'From your reading history.'
                        )
                )
        };
    }

    if (
        result.tool ===
        'get_book'
    ) {
        const book =
            extractBook(data);

        if (!book) {
            return {
                message:
                    "I couldn't find that book.",
                recommendations: []
            };
        }

        return {
            message:
                `Here is the information for "${book.title}".`,
            recommendations: [
                toRecommendation(
                    book,
                    [
                        book.author
                            ? `Author: ${book.author}`
                            : null,
                        book.published_year
                            ? `Published: ${book.published_year}`
                            : null,
                        book.average_rating != null
                            ? `Average rating: ${book.average_rating}`
                            : null
                    ]
                        .filter(Boolean)
                        .join(' · ')
                )
            ]
        };
    }

    if (
        result.tool ===
        'get_similar_books'
    ) {
        const books =
            extractBooks(data);

        const sourceBook =
            result.sourceBook ||
            context?.lastReferencedBook;

        if (!books.length) {
            return {
                message:
                    sourceBook
                        ? `I couldn't find any books similar to "${sourceBook.title}" in the current catalog.`
                        : "I couldn't find any similar books in the current catalog.",
                recommendations: []
            };
        }

        return {
            message:
                sourceBook
                    ? `Here are ${books.length} books similar to "${sourceBook.title}" that you might enjoy:`
                    : 'Here are some similar books you might enjoy:',
            recommendations:
                books.map(
                    (book) =>
                        toRecommendation(
                            book,
                            'Selected as a similar book from the BUQS catalog.'
                        )
                )
        };
    }

    if (
        result.tool ===
        'search_books'
    ) {
        const books =
            extractBooks(data);

        if (!books.length) {
            return {
                message: result.author
                    ? `I couldn't find any books by ${result.author} in the BUQS catalog.`
                    : result.query
                        ? `I couldn't find any books matching "${result.query}" in the BUQS catalog.`
                        : "I couldn't find matching books in the BUQS catalog.",
                recommendations: []
            };
        }

        return {
            message: result.author
                ? `Here are books by ${result.author} in the BUQS catalog:`
                : result.query
                    ? `Here are books matching "${result.query}":`
                    : 'Here are the matching books from the BUQS catalog:',
            recommendations: books.map(
                (book) =>
                    toRecommendation(
                        book,
                        result.author
                            ? `By ${book.author || result.author}.`
                            : 'Found in the BUQS catalog.'
                    )
            )
        };
    }

    if (
        result.tool ===
        'get_for_you_books'
    ) {
        const books =
            extractBooks(data);

        return {
            message: books.length
                ? 'Here are personalized recommendations from the BUQS catalog:'
                : "I couldn't find personalized recommendations right now.",
            recommendations: books.map(
                (book) =>
                    toRecommendation(
                        book,
                        'Selected for you from the BUQS catalog.'
                    )
            )
        };
    }

    if (
        result.tool ===
        'get_user_profile'
    ) {
        return {
            message:
                'Here is what I know about your reading profile.',
            recommendations: []
        };
    }

    return null;
};

export const createFinalResponse =
    async (
        userMessage,
        results,
        conversationId
    ) => {
        const deterministic =
            buildDeterministicResponse({
                message:
                    userMessage,
                results,
                context:
                    null
            });

        if (deterministic) {
            return LLMResponseSchema.parse(
                deterministic
            );
        }

        if (!Array.isArray(results) || !results.length) {
            return {
                message:
                    "I couldn't find enough catalog information to answer that. Try asking about a book, author, your notes, or recommendations.",
                recommendations: []
            };
        }

        const promptData = {
            userMessage,
            toolResults:
                results
        };

        try {
            const completion =
                await groq.chat.completions.create({
                    model:
                        GROQ_MODEL,
                    messages: [
                        {
                            role: 'system',
                            content:
                                FINAL_SYSTEM_PROMPT
                        },
                        {
                            role: 'user',
                            content:
                                JSON.stringify(
                                    promptData
                                )
                        }
                    ],
                    temperature: 0.1,
                    reasoning_effort:
                        'low',
                    max_completion_tokens:
                        FINAL_MAX_COMPLETION_TOKENS,
                    response_format: {
                        type:
                            'json_schema',
                        json_schema: {
                            name:
                                'librarian_response',
                            strict:
                                true,
                            schema:
                                FINAL_RESPONSE_SCHEMA
                        }
                    }
                });

            const content =
                completion
                    .choices[0]
                    ?.message
                    ?.content;

            if (!content) {
                throw new Error(
                    'Empty final LLM response'
                );
            }

            return LLMResponseSchema.parse(
                JSON.parse(content)
            );
        } catch (error) {
            console.error(
                `[Librarian:${conversationId}] Final response generation failed:`,
                error
            );

            return {
                message:
                    "I couldn't generate a response right now.",
                recommendations: []
            };
        }
    };

