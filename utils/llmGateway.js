import OpenAI from 'openai';
import 'dotenv/config';

const requiredKeys = ['GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'GROQ_API_KEY'];
const missingKeys = requiredKeys.filter((key) => !process.env[key]?.trim());
if (missingKeys.length > 0) {
    throw new Error(
        `[LLM Gateway] Missing required environment variables: ${missingKeys.join(', ')}. All 3 keys are strictly enforced.`
    );
}


export class CascadeExhaustionError extends Error {
    constructor(cascadeLogs) {
        super('All LLM providers in the fallback cascade failed or timed out.');
        this.name = 'CascadeExhaustionError';
        this.status = 503;
        this.cascadeLogs = cascadeLogs;
    }
}

export const PROVIDERS = [
    {
        name: 'Gemini',
        id: 'gemini',
        client: new OpenAI({
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
            apiKey: process.env.GEMINI_API_KEY
        }),
        model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
        defaultTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 6000,
        pausedUntil: 0
    },
    {
        name: 'Cerebras',
        id: 'cerebras',
        client: new OpenAI({
            baseURL: 'https://api.cerebras.ai/v1',
            apiKey: process.env.CEREBRAS_API_KEY
        }),
        model: process.env.CEREBRAS_MODEL || 'qwen-3.8-27b',
        defaultTimeoutMs: Number(process.env.CEREBRAS_TIMEOUT_MS) || 4000,
        pausedUntil: 0
    },
    {
        name: 'Groq',
        id: 'groq',
        client: new OpenAI({
            baseURL: 'https://api.groq.com/openai/v1',
            apiKey: process.env.GROQ_API_KEY
        }),
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        defaultTimeoutMs: Number(process.env.GROQ_TIMEOUT_MS) || 25000,
        pausedUntil: 0
    }
];

const getOrderedProviders = () => {
    const primary = (process.env.PRIMARY_LLM_PROVIDER || '').toLowerCase();
    if (!primary) return PROVIDERS;
    const match = PROVIDERS.find((p) => p.id === primary || p.name.toLowerCase() === primary);
    if (!match) return PROVIDERS;
    return [match, ...PROVIDERS.filter((p) => p !== match)];
};


let lastServedTelemetry = {
    provider: PROVIDERS[0].name,
    model: PROVIDERS[0].model,
    timestamp: Date.now()
};

export const getLastServedTelemetry = () => ({ ...lastServedTelemetry });

const sanitizeOptionsForProvider = (providerId, options) => {
    const clean = { ...options };
    delete clean.model;

    if (providerId !== 'groq' || !clean.model?.includes('gpt-oss')) {
        delete clean.reasoning_effort;
    }

    if (providerId === 'gemini' || providerId === 'cerebras') {
        delete clean.parallel_tool_calls;
    }

    
    if (providerId === 'gemini') {
        const tokenLimit = clean.max_completion_tokens || clean.max_tokens;
        if (tokenLimit && tokenLimit < 512) {
            clean.max_tokens = 512;
            delete clean.max_completion_tokens;
        }
    }

    if (providerId !== 'gemini' && Array.isArray(clean.messages)) {
        clean.messages = clean.messages.map((msg) => {
            if (msg && typeof msg === 'object') {
                const msgCopy = { ...msg };
                delete msgCopy.extra_content;
                if (Array.isArray(msgCopy.tool_calls)) {
                    msgCopy.tool_calls = msgCopy.tool_calls.map((tc) => {
                        const tcCopy = { ...tc };
                        delete tcCopy.extra_content;
                        return tcCopy;
                    });
                }
                return msgCopy;
            }
            return msg;
        });
    }

    return clean;
};


export const chatCompletion = async (options = {}) => {
    const cascadeLogs = [];
    const now = Date.now();
    const providers = getOrderedProviders();

    for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];

        if (provider.pausedUntil && now < provider.pausedUntil) {
            continue;
        }

        const timeoutMs = options.timeoutMs || provider.defaultTimeoutMs;
        const controller = new AbortController();
        const startTime = Date.now();

        const timer = setTimeout(() => {
            controller.abort();
        }, timeoutMs);

        try {
            const sanitized = sanitizeOptionsForProvider(provider.id, options);
            delete sanitized.timeoutMs;

            const completion = await provider.client.chat.completions.create(
                {
                    model: provider.model,
                    ...sanitized
                },
                {
                    signal: controller.signal
                }
            );

            clearTimeout(timer);
            const durationMs = Date.now() - startTime;
            provider.pausedUntil = 0; 

            lastServedTelemetry = {
                provider: provider.name,
                model: provider.model,
                durationMs,
                timestamp: Date.now()
            };

            Object.defineProperties(completion, {
                _servedByProvider: {
                    value: provider.name,
                    enumerable: true,
                    writable: true
                },
                _servedByModel: {
                    value: provider.model,
                    enumerable: true,
                    writable: true
                },
                _durationMs: {
                    value: durationMs,
                    enumerable: true,
                    writable: true
                },
                _cascadeLogs: {
                    value: cascadeLogs,
                    enumerable: false,
                    writable: true
                }
            });

            if (cascadeLogs.length > 0) {
                console.log(
                    `[LLM Gateway] Handled by ${provider.name} in ${durationMs}ms after ${cascadeLogs.length} failover(s).`
                );
            }

            return completion;
        } catch (error) {
            clearTimeout(timer);
            const durationMs = Date.now() - startTime;
            const isTimeout =
                error?.name === 'AbortError' ||
                controller.signal.aborted ||
                error?.message?.toLowerCase().includes('timeout') ||
                error?.message?.toLowerCase().includes('aborted');

            const status = error?.status || (isTimeout ? 408 : 500);
            const errorMsg = isTimeout
                ? `Timed out after ${timeoutMs}ms`
                : (error?.message || String(error));
            if (status === 402 || status === 404 || (status === 429 && errorMsg.includes('free_tier_requests'))) {
                provider.pausedUntil = Date.now() + 60_000;
                console.warn(`[LLM Gateway] Pausing ${provider.name} for 60s due to persistent ${status} error.`);
            }

            const logEntry = {
                provider: provider.name,
                model: provider.model,
                status,
                error: errorMsg,
                durationMs
            };

            cascadeLogs.push(logEntry);
            console.warn(
                `[LLM Gateway] ${provider.name} failed (${status}: ${errorMsg.slice(0, 80)}...). Failing over to next provider...`
            );
        }
    }

    console.error(
        `[LLM Gateway] Graceful Exhaustion: All ${providers.length} providers failed.`,
        cascadeLogs
    );
    throw new CascadeExhaustionError(cascadeLogs);
};

export const generalKnowledge = async (query, context = '') => {
    const messages = [
        {
            role: 'system',
            content: `You are a knowledgeable book expert. The user is asking about books that may not be in our catalog.
Provide 2-4 real, well-known book recommendations relevant to the user's query.
For each book include: title, author, published year, and a 1-sentence reason why it fits.
Return a clean, concise response. Do NOT make up fake books or fake authors.`
        },
        {
            role: 'user',
            content: context
                ? `Context from previous conversation: ${context}\n\nUser request: ${query}`
                : `User request: ${query}`
        }
    ];

    return chatCompletion({
        messages,
        temperature: 0.3,
        max_tokens: 512
    });
};
