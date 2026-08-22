
import { generateLibrarianResponse } from '../librarian/librarian.service.js';
import { ChatRequestSchema } from '../librarian/schemas.js';
import { trackEvent } from '../queues/analytics.queue.js';

export const askLibrarian = async (req, res) => {
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

        trackEvent(
            userId,
            'librarian_chat',
            {
                conversationId,
                queryLength: message.length,
                recommendationCount:
                    aiResponse?.recommendations?.length ?? 0
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