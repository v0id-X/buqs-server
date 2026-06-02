import dotenv from 'dotenv/config';
import pg from 'pg';

const {Pool} = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    client_encoding: 'UTF8'
});

export default pool;