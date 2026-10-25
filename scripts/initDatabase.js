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
let client;

try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('trackfusionweb_schema_init')::bigint)",
  );
  await client.query(schema);
  await client.query("COMMIT");
  console.log("TrackFusionWeb database schema initialized successfully");
} catch (error) {
  if (client) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original initialization error below.
    }
  }
  console.error("Unable to initialize TrackFusionWeb database:", error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
