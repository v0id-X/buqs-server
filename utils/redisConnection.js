import Redis from 'ioredis';
import 'dotenv/config';

const isCluster = (process.env.REDIS_MODE || 'cluster').toLowerCase() === 'cluster';

export const redisConnection = isCluster
    ? new Redis.Cluster(
        [{ host: process.env.REDIS_HOST, port: process.env.REDIS_PORT }],
        {
            redisOptions: {
                password: process.env.REDIS_PASSWORD,
                tls: { servername: process.env.REDIS_HOST },
                maxRetriesPerRequest: null
            }
        }
    )
    : new Redis({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === 'false' ? undefined : {},
        maxRetriesPerRequest: null
    });

redisConnection.on('connect', () => {
    console.log(`[Redis] Connected (${isCluster ? 'cluster' : 'standalone'} mode)`);
});

redisConnection.on('error', (err) => {
    console.error('[Redis Error]', err);
});