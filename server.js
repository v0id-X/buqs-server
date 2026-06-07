import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';

import pool from './db/db.js';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import bookRoutes from './routes/book.routes.js';
import noteRoutes from './routes/note.routes.js';
import ratingRoutes from './routes/rating.routes.js';
import libraryRoutes from './routes/library.routes.js';


import './workers/analytics.worker.js';
import { startStatsCron } from './workers/statsAggregator.js';
import { startAffinityCron } from './workers/affinityAggregator.js';
import { startSimilarityCron } from './workers/similarityAggregator.js';


EventEmitter.defaultMaxListeners = 20; 
const app = express();
const PORT = process.env.PORT || 8000;

app.set('trust proxy',1);
app.use(cors({
    origin:
        process.env.FRONTEND_URL,
        credentials:true
}));

app.use(express.json());


app.get('/health', (req, res) => {
    res.status(200).send('Server is healthy and running.');
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/library', libraryRoutes);


const initializeBackgroundWorkers = () => {
    console.log('[System] Starting scheduled cron jobs...');
    startStatsCron();
    startAffinityCron();
    startSimilarityCron();
};

const startServer = async () => {
    try {

        await pool.connect();
        console.log('[Database] Connected to PostgreSQL successfully.');
        initializeBackgroundWorkers();

        app.listen(PORT || 8000, () => {
            console.log(`[Server] Listening on PORT: ${PORT}`);
            console.log(`[Server] Health Check: http://localhost:${PORT}/health`);
        });

    } catch (error) {
        console.error('[System] Critical error during server startup:', error);
        process.exit(1);
    }
};

startServer();