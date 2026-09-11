
import {
    chatCompletion
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
    getNoteContent,
    compactToolResultForLlm
} from './librarian.book-utils.js';

import {
    asksForLastFinishedBook,
    normalizeTitle
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
            notes: [],
            source: 'catalog'
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
            })),
        source: 'catalog'
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

    if (result.tool === 'agent_clarification') {
        return {
            message:
                data?.message ||
                "I'm the BUQS Librarian \u2014 I can help with books, authors, genres, ratings, trends, and your reading history. What would you like to know?",
            recommendations: [],
            source: 'catalog'
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
                recommendations: [],
                source: 'catalog'
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
                    .filter(Boolean),
            source: 'catalog'
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
        result.tool === 'get_reading_history' ||
        result.tool === 'get_user_library'
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
                    "I couldn't find any books in your library matching that request.",
                recommendations: [],
                source: 'catalog'
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
                recommendations: [],
                source: 'catalog'
            };
        }

        return {
            message:
                'Here are the books from your library:',
            recommendations:
                books.map((book) => {
                    const rawStatus = book.status || book.user_library_status;
                    let statusLabel = 'Library';
                    if (rawStatus === 'reading') statusLabel = 'Currently Reading';
                    else if (rawStatus === 'wishlist') statusLabel = 'Wishlist';
                    else if (rawStatus === 'finished') statusLabel = 'Finished';

                    return {
                        ...toRecommendation(
                            book,
                            `From your library (${statusLabel}).`
                        ),
                        status: statusLabel,
                        source: 'library'
                    };
                }),
            source: 'catalog'
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
                recommendations: [],
                source: 'catalog'
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
                ),
            source: 'catalog'
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
                recommendations: [],
                source: 'catalog'
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
                        .join(' \u00b7 ')
                )
            ],
            source: 'catalog'
        };
    }

    if (
        result.tool ===
        'get_user_profile'
    ) {
        return {
            message:
                'Here is what I know about your reading profile.',
            recommendations: [],
            source: 'catalog'
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
                recommendations: [],
                source: 'catalog'
            };
        }

        const hasAiKnowledge = results.some(
            (r) =>
                r.tool === 'search_general_knowledge' ||
                r.source === 'ai_knowledge'
        );

        const promptData = {
            userMessage,
            toolResults: results.map((r) => ({
                tool: r.tool,
                data: compactToolResultForLlm(r.data),
                sourceBook: r.sourceBook,
                source: r.source
            }))
        };

        try {
            const completion =
                await chatCompletion({
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
                        type: 'json_object'
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

            const parsed = JSON.parse(content);
            parsed._servedByProvider = completion._servedByProvider;
            parsed._servedByModel = completion._servedByModel;

            parsed.message = String(
                parsed.message ||
                parsed.response ||
                parsed.text ||
                parsed.content ||
                'Here are some recommendations based on your request:'
            ).trim();

            parsed.source = hasAiKnowledge
                ? 'ai_knowledge'
                : (parsed.source || 'catalog');

            parsed.notes = Array.isArray(parsed.notes) ? parsed.notes : [];

            // Build lookup maps from all raw tool results to re-attach cover_image, status, etc.
            const catalogByIsbn = new Map();
            const catalogByTitle = new Map();

            for (const r of results) {
                const books = extractBooks(r.data);
                for (const b of books) {
                    if (b.isbn) catalogByIsbn.set(String(b.isbn).trim(), b);
                    if (b.title) catalogByTitle.set(normalizeTitle(b.title), b);
                }
            }

            const rawRecs = Array.isArray(parsed.recommendations)
                ? parsed.recommendations
                : (Array.isArray(parsed.books) ? parsed.books : []);

            parsed.recommendations = rawRecs.map((rec) => {
                const isbn = String(rec.isbn || 'N/A').trim();
                const matched = catalogByIsbn.get(isbn) || catalogByTitle.get(normalizeTitle(rec.title));

                const cover_image = rec.cover_image || matched?.cover_image || null;
                const author = rec.author || matched?.author || null;
                const rawStatus = rec.status || rec.user_library_status || matched?.status || matched?.user_library_status || null;

                let statusLabel = null;
                if (rawStatus) {
                    const s = String(rawStatus).toLowerCase().trim();
                    if (s === 'reading' || s === 'currently reading' || s === 'currently_reading') {
                        statusLabel = 'Currently Reading';
                    } else if (s === 'wishlist' || s === 'to-read') {
                        statusLabel = 'Wishlist';
                    } else if (s === 'finished' || s === 'read') {
                        statusLabel = 'Finished';
                    }
                }

                let reason = String(rec.reason || '').trim();
                if (statusLabel) {
                    if (!reason.toLowerCase().includes('from your library') && !reason.toLowerCase().includes('in your library')) {
                        reason = reason ? `From your library (${statusLabel}). ${reason}` : `From your library (${statusLabel}).`;
                    }
                } else if (!reason) {
                    reason = 'Recommended for you';
                }

                return {
                    isbn: (matched?.isbn ? String(matched.isbn).trim() : isbn),
                    title: String(rec.title || matched?.title || 'Untitled').trim(),
                    author,
                    cover_image,
                    reason,
                    bookUrl: rec.bookUrl || matched?.bookUrl || (isbn !== 'N/A' ? `/books/${encodeURIComponent(isbn)}` : '#'),
                    noteUrl: rec.noteUrl || matched?.noteUrl || null,
                    source: rec.source || (statusLabel ? 'library' : parsed.source),
                    status: statusLabel
                };
            });

            return LLMResponseSchema.parse(parsed);
        } catch (error) {
            console.error(
                `[Librarian:${conversationId}] Final response generation failed:`,
                error.message
            );

            return {
                message:
                    "I had some trouble formatting that response, but I'm still here to help. Could you try asking again?",
                recommendations: [],
                source: 'catalog'
            };
        }
    };
