import {
    chatCompletion,
    generalKnowledge,
    PROVIDERS,
    CascadeExhaustionError,
    getLastServedTelemetry
} from '../utils/llmGateway.js';

export const GROQ_MODEL = PROVIDERS[0].model;

export {
    chatCompletion,
    generalKnowledge,
    PROVIDERS,
    CascadeExhaustionError,
    getLastServedTelemetry
};