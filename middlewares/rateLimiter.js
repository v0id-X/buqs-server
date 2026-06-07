import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisConnection } from '../utils/redisConnection.js';


const createRedisStore = (prefix) => {
    return new RedisStore({
        sendCommand: (...args) => redisConnection.call(...args),
        prefix: prefix,
    });
};

export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    limit: 150, 
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createRedisStore('rl:api:'),
    message: { success: false, message: 'Too many requests to the API. Please slow down.' }
});


export const searchLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    limit: 30, 
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createRedisStore('rl:search:'),
    message: { success: false, message: 'You are searching too fast. Take a breath!' }
});


export const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, 
    limit: 12, 
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createRedisStore('rl:auth:'),
    message: { success: false, message: 'Too many login attempts. Please try again in an hour.' }
});

export const contentCreationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    limit: 30, 
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createRedisStore('rl:notes:'),
    message: { success: false, message: 'You are creating notes too quickly. Please take a break.' }
});

export const libraryAndRatingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    limit: 100, 
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createRedisStore('rl:library:'),
    message: { success: false, message: 'Too many library/rating updates. Please slow down.' }
});