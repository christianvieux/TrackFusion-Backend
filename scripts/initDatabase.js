import { readFile } from "fs/promises";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to initialize the database");
  process.exit(1);
}

const schema = await readFile(new URL("../init_database.sql", import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(schema);
  console.log("TrackFusionWeb database schema initialized successfully");
} catch (error) {
  console.error("Unable to initialize TrackFusionWeb database:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
