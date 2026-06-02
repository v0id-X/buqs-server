
export const getCohortBucket = (userId, totalBuckets = 20) => {
    let hash = 0;
    const str = String(userId);
    for (let i = 0; i < str.length; i++) {
        hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % totalBuckets;
};

export const seededRandom = (bucketId, isbn) => {
    let seed = 0;
    
    const today = new Date().toISOString().split('T')[0];
    
    const str = `${bucketId}_${isbn}_${today}`;
    
    for (let i = 0; i < str.length; i++) {
        seed = (Math.imul(31, seed) + str.charCodeAt(i)) | 0;
    }
    
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};