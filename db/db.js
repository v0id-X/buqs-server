import dotenv from 'dotenv/config';
import pg from 'pg';

const {Pool} = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    client_encoding: 'UTF8',
    max: Number(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

export default pool;