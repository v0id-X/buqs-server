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
    executeFastPath
} from './librarian.direct.js';

import {
    executeAgentRequest
} from './librarian.agent.js';

import {
    createFinalResponse,
    buildDeterministicResponse
} from './librarian.response.js';

import {
    getLastServedTelemetry,
    CascadeExhaustionError
} from '../utils/llmGateway.js';

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

            let route = 'fast_path';
            let context = initialContext;
            let results;

            const fastPath =
                await executeFastPath({
                    userId,
                    message:
                        safeMessage,
                    conversationId,
                    context,
                    isSafeMode
                });

            if (fastPath.handled) {
                route = getRouteName(
                    'fast_path',
                    fastPath.results
                );

                context =
                    fastPath.context ||
                    context;

                results =
                    fastPath.results;
            } else {
                route = 'agent';

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

                route = getRouteName(
                    'agent',
                    results
                );
            }

            const hasAiKnowledge =
                Array.isArray(results) &&
                results.some(
                    (r) =>
                        r.tool === 'search_general_knowledge' ||
                        r.source === 'ai_knowledge'
                );

            const deterministic =
                buildDeterministicResponse({
                    message:
                        safeMessage,
                    results,
                    context
                });

            let finalResponse;

            if (deterministic) {
                finalResponse = deterministic;
            } else {
                finalResponse =
                    await createFinalResponse(
                        safeMessage,
                        results,
                        conversationId
                    );
            }

            if (hasAiKnowledge && finalResponse) {
                finalResponse.source = 'ai_knowledge';

                if (Array.isArray(finalResponse.recommendations)) {
                    for (const rec of finalResponse.recommendations) {
                        if (!rec.source) {
                            rec.source = 'ai_knowledge';
                        }
                    }
                }
            }

            if (!finalResponse.source) {
                finalResponse.source = 'catalog';
            }

            if (Array.isArray(finalResponse.recommendations)) {
                for (const rec of finalResponse.recommendations) {
                    if (!rec.source) {
                        rec.source = 'catalog';
                    }
                }
            }

            await saveResponse(
                conversationId,
                history,
                safeMessage,
                finalResponse
            );

            const telemetry = getLastServedTelemetry();

            return attachLibrarianMetrics(
                finalResponse,
                {
                    route,
                    previousShownIsbns,
                    provider: telemetry.provider,
                    model: telemetry.model
                }
            );
        } catch (error) {
            if (error instanceof CascadeExhaustionError || error.name === 'CascadeExhaustionError') {
                throw error;
            }

            console.error(
                `[Librarian:${conversationId}] Fatal error:`,
                error
            );

            return attachLibrarianMetrics(
                {
                    message:
                        "I'm having trouble right now. Please try again in a moment.",
                    recommendations: [],
                    notes: [],
                    source: 'catalog'
                },
                {
                    route: 'error',
                    previousShownIsbns: []
                }
            );
        } finally {
            console.timeEnd(
                `[Librarian:${conversationId}] total`
            );
        }
    };
