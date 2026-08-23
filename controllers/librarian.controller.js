
import {
    performance
} from 'node:perf_hooks';

import { generateLibrarianResponse } from '../librarian/librarian.service.js';
import { ChatRequestSchema } from '../librarian/schemas.js';
import { trackEvent } from '../queues/analytics.queue.js';

const isFollowUpRequest = (message) => {
    const value = String(message || '').toLowerCase();

    return /\b(?:something else|anything else|some other|show(?:\s+me)? more|more by|other by|another by)\b/.test(value) ||
        (
            /\b(?:highest|lowest|best|worst|rating|rated)\b/.test(value) &&
            /\b(?:among|of)\s+(?:these|those|them|the\s+(?:last\s+)?(?:books?|results?|recommendations?))\b/.test(value)
        );
};

const getRecommendationIsbns = (response) => [
    ...new Set(
        (Array.isArray(response?.recommendations)
            ? response.recommendations
            : [])
            .map((book) => String(book?.isbn || '').trim())
            .filter(Boolean)
    )
];

export const askLibrarian = async (req, res) => {
    const startedAt = performance.now();

    try {
        const parsed = ChatRequestSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: 'Invalid request payload',
                details: parsed.error.format()
            });
        }

        const {
            message,
            conversationId,
            safe_mode
        } = parsed.data;

        const userId = req.user.id;

        const isSafeMode =
            safe_mode ||
            req.query.safe_mode === 'true';

        const aiResponse = await generateLibrarianResponse(
            userId,
            message,
            conversationId,
            isSafeMode
        );

        const librarianMetrics =
            aiResponse?.__librarianMetrics || {};

        const recommendationIsbns =
            getRecommendationIsbns(aiResponse);

        const isFollowUp =
            isFollowUpRequest(message);

        const previousShownIsbns = Array.isArray(
            librarianMetrics.previousShownIsbns
        )
            ? librarianMetrics.previousShownIsbns.map(String)
            : [];

        const repeatedRecommendationCount = isFollowUp
            ? recommendationIsbns.filter((isbn) =>
                previousShownIsbns.includes(isbn)
            ).length
            : 0;

        trackEvent(
            userId,
            'librarian_chat',
            {
                conversationId,
                queryLength: message.length,
                route: librarianMetrics.route || 'unknown',
                responseMs: Number(
                    (performance.now() - startedAt).toFixed(2)
                ),
                isFollowUp,
                recommendationCount:
                    recommendationIsbns.length,
                repeatedRecommendationCount,
                repeatFree:
                    isFollowUp &&
                    recommendationIsbns.length > 0
                        ? repeatedRecommendationCount === 0
                        : null
            }
        ).catch(console.error);

        return res.status(200).json({
            success: true,
            data: aiResponse
        });
    } catch (error) {
        console.error('[Librarian Controller] Error:', error);

        return res.status(500).json({
            success: false,
            message:
                'The library is currently too loud. Please try asking again in a moment.'
        });
    }
};
