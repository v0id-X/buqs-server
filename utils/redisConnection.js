
import Redis from 'ioredis';
import 'dotenv/config';

export const redisConnection = new Redis.Cluster(
    [
        {
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT
        }
    ],
    {
        redisOptions: {
            password: process.env.REDIS_PASSWORD,
            tls: {
                servername: process.env.REDIS_HOST
            },
            maxRetriesPerRequest: null
        }
    }
);

redisConnection.on('connect', () => {
    console.log('[Redis] Connected to Azure Managed Redis Cluster');
});

redisConnection.on('error', (err) => {
    console.error('[Redis Error]', err);
});