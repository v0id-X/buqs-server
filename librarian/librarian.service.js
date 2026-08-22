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

                return deterministicBook.disambiguation;
            }

            let context =
                deterministicBook.context ||
                initialContext;

            let results;

            if (
                deterministicBook.handled
            ) {
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
                    results =
                        direct.results;
                } else {
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

                return disambiguation;
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

            return finalResponse;
        } finally {
            console.timeEnd(
                `[Librarian:${conversationId}] total`
            );
        }
    };
