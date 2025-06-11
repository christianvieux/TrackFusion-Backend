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

// Test the connection on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to the database:', {
            message: err.message,
            stack: err.stack,
            code: err.code
        });
        return;
    }
    release();
    console.log('Successfully connected to database');
});

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
            params,
            error: err.message,
            code: err.code
        });
        throw err;
    }
}

export default pool;
