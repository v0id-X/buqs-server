import {
    z
} from 'zod';

export const ChatRequestSchema =
    z.object({
        conversationId:
            z.string()
                .min(1)
                .max(100),

        message:
            z.string()
                .min(1)
                .max(500),

        safe_mode:
            z.boolean()
                .optional()
                .default(false)
    });

export const RecommendationSchema =
    z.object({
        isbn:
            z.string(),

        title:
            z.string(),

        author:
            z.string()
                .nullable(),

        cover_image:
            z.string()
                .nullable(),

        reason:
            z.string(),

        bookUrl:
            z.string(),

        noteUrl:
            z.string()
                .nullable()
    });

export const NoteSchema =
    z.object({
        id: z.union([
            z.string(),
            z.number()
        ]),

        title: z.string(),

        content: z.string()
            .nullable(),

        noteUrl: z.string()
    });

export const LLMResponseSchema =
    z.object({
        message:
            z.string(),

        recommendations:
            z.array(
                RecommendationSchema
            ),

        notes:
            z.array(NoteSchema)
                .default([])
    });
