
import { redisConnection } from './redisConnection.js';
import Fuse from 'fuse.js';
import zlib from 'zlib';
import { promisify } from 'util';

const inflate = promisify(zlib.inflate);

export let allFuseIndex = null; 
export let safeFuseIndex = null; 


export const refreshSearchCache = async () => {
    try {
        const compressedBase64 = await redisConnection.get('search:dictionary');
        
        if (compressedBase64) {
            const buffer = Buffer.from(compressedBase64, 'base64');
            const decompressedString = await inflate(buffer);
            const globalSearchDictionary = JSON.parse(decompressedString.toString());

            const safeSearchDictionary = globalSearchDictionary.filter(book => 
                book.is_adult === false || 
                book.is_adult === 'false' || 
                book.is_adult == null
            );

            const fuseOptions = {
                keys: ['searchable_string'],
                threshold: 0.3, 
                shouldSort: true 
            };

            allFuseIndex = new Fuse(globalSearchDictionary, fuseOptions);
            safeFuseIndex = new Fuse(safeSearchDictionary, fuseOptions);

            console.log(`[Search-Cache] Ram Indexes Built:`);
            console.log(` ---> All Books: ${globalSearchDictionary.length}`);
            console.log(` ---> Safe Books: ${safeSearchDictionary.length}`);
        }
    } catch (error) {
        console.error("[Search-Cache] Failed to load search dictionary from Redis:", error);
    }
};


setInterval(refreshSearchCache, 5 * 60 * 1000);