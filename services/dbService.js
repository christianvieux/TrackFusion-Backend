// env
import dotenv from "dotenv";
dotenv.config();
// Postgres client
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // ssl: {
    //     rejectUnauthorized: false, // for Fly.io self-signed certs
    // },
});

// Add connection error handling
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err.stack);
});

export async function verifyDatabaseConnection() {
    const client = await pool.connect();
    try {
        await client.query('SELECT 1');
    } finally {
        client.release();
    }
}

export async function queryToDatabase(text, params = []) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        // console.log("executed query", { text, duration, rows: res.rowCount });
        return res;
    } catch (err) {
        console.error("Database query error:", {
            text,
            error: err.message,
            code: err.code
        });
        throw err;
    }
}

export async function withTransaction(callback) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const result = await callback((text, params = []) => client.query(text, params));
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export default pool;
