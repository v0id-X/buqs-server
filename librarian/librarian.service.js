import {
    getConversationHistory,
    saveConversationHistory,
    getConversationContext,
    saveConversationContext
} from './memory.js';

import {
    normalizeMessage
} from './librarian.parsers.js';

import {
    executeDeterministicBookLookup,
    executeDirectRequest
} from './librarian.direct.js';

import {
    executeAgentRequest
} from './librarian.agent.js';

import {
    createFinalResponse,
    buildDeterministicResponse
} from './librarian.response.js';

import {
    createDisambiguationResponse
} from './librarian.reference.js';

const saveResponse = async (
    conversationId,
    history,
    message,
    response
) => {
    await saveConversationHistory(
        conversationId,
        [
            ...history,
            {
                role: 'user',
                content: message
            },
            {
                role: 'assistant',
                content:
                    response.message
            }
        ]
    );
};

const getPreviousShownIsbns = (
    context
) => [
    ...new Set([
        ...(Array.isArray(
            context?.lastRecommendation?.shownIsbns
        )
            ? context.lastRecommendation.shownIsbns
            : []),
        ...(Array.isArray(
            context?.lastGenreRecommendation?.shownIsbns
        )
            ? context.lastGenreRecommendation.shownIsbns
            : [])
    ]
        .map((isbn) => String(isbn || '').trim())
        .filter(Boolean))
].slice(-100);

const attachLibrarianMetrics = (
    response,
    metrics
) => {
    if (!response || typeof response !== 'object') {
        return response;
    }

    Object.defineProperty(
        response,
        '__librarianMetrics',
        {
            value: metrics,
            enumerable: false,
            configurable: false,
            writable: false
        }
    );

    return response;
};

const getRouteName = (
    prefix,
    results
) => {
    const tool = Array.isArray(results)
        ? results[0]?.tool
        : null;

    return tool
        ? `${prefix}:${tool}`
        : prefix;
};

export const generateLibrarianResponse =
    async (
        userId,
        message,
        conversationId,
        isSafeMode
    ) => {
        console.time(
            `[Librarian:${conversationId}] total`
        );

        try {
            const [
                history,
                initialContext
            ] = await Promise.all([
                getConversationHistory(
                    conversationId
                ),
                getConversationContext(
                    conversationId
                )
            ]);

            const safeMessage =
                normalizeMessage(
                    message
                );

            const previousShownIsbns =
                getPreviousShownIsbns(
                    initialContext
                );

            let route =
                'deterministic_book_lookup';

            const deterministicBook =
                await executeDeterministicBookLookup({
                    userId,
                    message:
                        safeMessage,
                    conversationId,
                    context:
                        initialContext,
                    isSafeMode
                });

            if (
                deterministicBook.disambiguation
            ) {
                await saveResponse(
                    conversationId,
                    history,
                    safeMessage,
                    deterministicBook.disambiguation
                );

                return attachLibrarianMetrics(
                    deterministicBook.disambiguation,
                    {
                        route:
                            'deterministic_book_lookup_disambiguation',
                        previousShownIsbns
                    }
                );
            }

            let context =
                deterministicBook.context ||
                initialContext;

            let results;

            if (
                deterministicBook.handled
            ) {
                route = getRouteName(
                    'deterministic_book_lookup',
                    deterministicBook.results
                );

                results =
                    deterministicBook.results;
            } else {
                const direct =
                    await executeDirectRequest({
                        userId,
                        message:
                            safeMessage,
                        conversationId,
                        context,
                        isSafeMode
                    });

                context =
                    direct.context ||
                    context;

                if (
                    direct.handled
                ) {
                    route = getRouteName(
                        'direct',
                        direct.results
                    );

                    results =
                        direct.results;
                } else {
                    route = 'agent_fallback';

                    const agent =
                        await executeAgentRequest({
                            userId,
                            message:
                                safeMessage,
                            conversationId,
                            history,
                            context,
                            isSafeMode
                        });

                    results =
                        agent.results;

                    context =
                        agent.context ||
                        context;
                }
            }

            const searchResults =
                Array.isArray(results)
                    ? results
                        .filter(
                            (result) =>
                                result.tool ===
                                'search_books' &&
                                !result.author
                        )
                        .flatMap(
                            (result) =>
                                Array.isArray(
                                    result.data
                                )
                                    ? result.data
                                    : []
                        )
                    : [];

            const disambiguation =
                createDisambiguationResponse(
                    searchResults
                );

            if (
                disambiguation
            ) {
                await saveResponse(
                    conversationId,
                    history,
                    safeMessage,
                    disambiguation
                );

                return attachLibrarianMetrics(
                    disambiguation,
                    {
                        route:
                            `${route}_disambiguation`,
                        previousShownIsbns
                    }
                );
            }

            const deterministic =
                buildDeterministicResponse({
                    message:
                        safeMessage,
                    results,
                    context
                });

            const finalResponse =
                deterministic ||
                await createFinalResponse(
                    safeMessage,
                    results,
                    conversationId
                );

            await saveResponse(
                conversationId,
                history,
                safeMessage,
                finalResponse
            );

            return attachLibrarianMetrics(
                finalResponse,
                {
                    route,
                    previousShownIsbns
                }
            );
        } finally {
            console.timeEnd(
                `[Librarian:${conversationId}] total`
            );
        }
    };
