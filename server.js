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
import { startCronJobs } from './workers/statsAggregator.js';
import { startAffinityCronJobs } from './workers/affinityAggregator.js';
import { startSearchAggregator, runSearchAggregation } from './workers/searchAggregator.js';
import { refreshSearchCache } from './utils/searchCache.js';
import { startSimilarityCron } from './workers/similarityAggregator.js';


EventEmitter.defaultMaxListeners = 20; 
const app = express();
const PORT = process.env.PORT || 8000;


app.use(cors());
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
    startCronJobs();
    startAffinityCronJobs();
    startSearchAggregator();
    startSimilarityCron();
};

const startServer = async () => {
    try {

        await pool.connect();
        console.log('[Database] Connected to PostgreSQL successfully.');

        console.log('[Cache] Building initial search dictionary...');
        await runSearchAggregation();
        await refreshSearchCache();

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