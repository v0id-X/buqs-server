
import {
    performance
} from 'node:perf_hooks';

import { generateLibrarianResponse } from '../librarian/librarian.service.js';
import { isFollowUpRequest } from '../librarian/librarian.parsers.js';
import { ChatRequestSchema } from '../librarian/schemas.js';
import { trackEvent } from '../queues/analytics.queue.js';

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
                        : null,
                provider: librarianMetrics.provider || 'unknown',
                model: librarianMetrics.model || 'unknown'
            }
        ).catch(console.error);

        if (librarianMetrics.provider) {
            res.setHeader('X-Served-By-Provider', librarianMetrics.provider);
        }
        if (librarianMetrics.model) {
            res.setHeader('X-Served-By-Model', librarianMetrics.model);
        }

        return res.status(200).json({
            success: true,
            data: aiResponse
        });
    } catch (error) {
        console.error('[Librarian Controller] Error:', error);

        if (error.name === 'CascadeExhaustionError' || error.status === 503) {
            return res.status(503).json({
                success: false,
                message: 'AI service temporarily unavailable',
                cascadeLogs: error.cascadeLogs || []
            });
        }

        return res.status(500).json({
            success: false,
            message:
                'The library is currently too loud. Please try asking again in a moment.'
        });
    }
};
