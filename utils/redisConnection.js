import Redis from "ioredis";
import 'dotenv/config';

export const redisConnection = new Redis(process.env.REDIS_URL,{
    maxRetriesPerRequest: null
});


redisConnection.on('connect',()=>{
    console.log("Redis Connected");
});

redisConnection.on('error',()=>{
    console.error('Redis Connection error');
})
