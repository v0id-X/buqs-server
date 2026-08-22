
import {
    redisConnection
} from '../utils/redisConnection.js';

const TTL_SECONDS = 3600;
const MAX_HISTORY_MESSAGES = 32;

export const getConversationHistory =
    async (
        conversationId
    ) => {
        try {
            const key =
                `librarian:chat:${conversationId}`;

            const data =
                await redisConnection.get(
                    key
                );

            if (!data) {
                return [];
            }

            const parsed =
                JSON.parse(data);

            return Array.isArray(
                parsed
            )
                ? parsed
                : [];
        } catch (
            error
        ) {
            console.error(
                '[Librarian Memory] Error fetching history:',
                error
            );

            return [];
        }
    };

export const saveConversationHistory =
    async (
        conversationId,
        messages
    ) => {
        try {
            const key =
                `librarian:chat:${conversationId}`;

            const trimmedMessages =
                messages.slice(
                    -MAX_HISTORY_MESSAGES
                );

            await redisConnection.set(
                key,
                JSON.stringify(
                    trimmedMessages
                ),
                'EX',
                TTL_SECONDS
            );
        } catch (
            error
        ) {
            console.error(
                '[Librarian Memory] Error saving history:',
                error
            );
        }
    };

export const getConversationContext =
    async (
        conversationId
    ) => {
        try {
            const key =
                `librarian:context:${conversationId}`;

            const data =
                await redisConnection.get(
                    key
                );

            if (!data) {
                return {};
            }

            const parsed =
                JSON.parse(data);

            return parsed &&
                typeof parsed ===
                    'object'
                ? parsed
                : {};
        } catch (
            error
        ) {
            console.error(
                '[Librarian Memory] Error fetching context:',
                error
            );

            return {};
        }
    };

export const saveConversationContext =
    async (
        conversationId,
        context
    ) => {
        try {
            const key =
                `librarian:context:${conversationId}`;

            await redisConnection.set(
                key,
                JSON.stringify(
                    context
                ),
                'EX',
                TTL_SECONDS
            );
        } catch (
            error
        ) {
            console.error(
                '[Librarian Memory] Error saving context:',
                error
            );
        }
    };

export const clearConversation =
    async (
        conversationId
    ) => {
        try {
            await Promise.all([
                redisConnection.del(
                    `librarian:chat:${conversationId}`
                ),
                redisConnection.del(
                    `librarian:context:${conversationId}`
                )
            ]);
        } catch (
            error
        ) {
            console.error(
                '[Librarian Memory] Error clearing conversation:',
                error
            );
        }
    };
