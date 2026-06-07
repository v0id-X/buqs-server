import { redisConnection } from './utils/redisConnection.js'; // adjust path

try {
    const keyCount = await redisConnection.dbsize();
    console.log(`Keys before flush: ${keyCount}`);

    await redisConnection.flushall();

    console.log('Redis FLUSHALL completed');

    const afterCount = await redisConnection.dbsize();
    console.log(`Keys after flush: ${afterCount}`);
} catch (err) {
    console.error('Flush failed:', err);
} finally {
    redisConnection.disconnect();
}