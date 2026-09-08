import Redis from 'ioredis';
import 'dotenv/config';

const createConnection = () => {
    const redisUrl = process.env.REDIS_URL?.trim();

    if (redisUrl) {
        let servername;
        try {
            const parsedUrl = new URL(redisUrl);
            servername = parsedUrl.hostname;
        } catch {
            servername = undefined;
        }

        const isTls = redisUrl.startsWith('rediss://') || process.env.REDIS_TLS !== 'false';

        const client = new Redis(redisUrl, {
            tls: isTls && servername ? { servername } : undefined,
            maxRetriesPerRequest: null,
            family: Number(process.env.REDIS_FAMILY) || 0
        });

        client.on('connect', () => {
            console.log(`[Redis] Connected to ${servername || 'endpoint'} via REDIS_URL (standalone mode)`);
        });

        return client;
    }

    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = Number(process.env.REDIS_PORT) || 6379;
    const isCluster = (process.env.REDIS_MODE || (host.includes('redis.azure.net') || port === 10000 ? 'cluster' : 'standalone')).toLowerCase() === 'cluster';

    if (isCluster) {
        const client = new Redis.Cluster(
            [{ host, port }],
            {
                redisOptions: {
                    password: process.env.REDIS_PASSWORD,
                    tls: process.env.REDIS_TLS === 'false'
                        ? undefined
                        : { servername: host },
                    maxRetriesPerRequest: null
                }
            }
        );

        client.on('connect', () => {
            console.log(`[Redis] Connected to ${host}:${port} (cluster mode)`);
        });

        return client;
    }

    const isTls = process.env.REDIS_TLS === 'false'
        ? undefined
        : (host ? { servername: host } : undefined);

    const client = new Redis({
        host,
        port,
        password: process.env.REDIS_PASSWORD,
        tls: isTls,
        maxRetriesPerRequest: null,
        family: Number(process.env.REDIS_FAMILY) || 0
    });

    client.on('connect', () => {
        console.log(`[Redis] Connected to ${host}:${port} (standalone mode)`);
    });

    return client;
};

export const redisConnection = createConnection();

redisConnection.on('error', (err) => {
    if (err?.code === 'ENOTFOUND') {
        console.error(`[Redis Error] DNS lookup failed: Host "${err.hostname}" cannot be resolved. Check your REDIS_HOST or REDIS_URL in .env.`);
    } else {
        console.error('[Redis Error]', err?.message || err);
    }
});