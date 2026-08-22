import Groq from 'groq-sdk';
import 'dotenv/config';

export const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

export const GROQ_MODEL = 'openai/gpt-oss-20b';