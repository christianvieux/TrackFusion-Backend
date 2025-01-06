import dotenv from 'dotenv';
dotenv.config();  // Load environment variables from .env file

import pg from "pg";

const config = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "Web Data",
  port: 5432,
  ssl: { rejectUnauthorized: false }, // allow self-signed SSL certificates for Azure
};

const database = new pg.Client(config);

console.log('Connecting to the database...');

database.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:');
    console.error('Details:', err.stack);
    console.error('Error code:', err.code);  // Shows error code
    console.error('Error message:', err.message);  // Shows error message
    return;
  }
  console.log('Connected to the database');
});

// Optionally, you can add an event listener for 'end' to log when the connection is closed
database.on('end', () => {
  console.log('Database connection closed');
});

export default database;