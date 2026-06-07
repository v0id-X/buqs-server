
import { Queue } from "bullmq";
import { redisConnection } from "../utils/redisConnection.js";

const analyticsQueue = new Queue('analytics-queue',{
    connection: redisConnection,
    prefix:'{analytics}'
});

export const trackEvent = async(userId,eventType,eventData={}) =>{
    try{
        await analyticsQueue.add('track',{
            userId,
            eventType,
            eventData
        },{
            removeOnComplete: true,
            removeOnFail: 100 
        });
    } catch(error){
        console.error(`[Analytics Queue] Failed to queue ${eventType}`,error);
    }
};