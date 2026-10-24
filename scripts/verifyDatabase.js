import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to verify the database");
  process.exit(1);
}

const expectedTables = [
  "otp_codes",
  "password_reset_tokens",
  "tracks",
  "users",
];
const expectedTypes = ["category_enum", "genre_enum", "mood_enum"];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const tableResult = await pool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name`,
    [expectedTables],
  );
  const typeResult = await pool.query(
    `SELECT typname
       FROM pg_type
      WHERE typname = ANY($1::text[])
      ORDER BY typname`,
    [expectedTypes],
  );

  const actualTables = tableResult.rows.map(({ table_name }) => table_name);
  const actualTypes = typeResult.rows.map(({ typname }) => typname);
  const missingTables = expectedTables.filter((name) => !actualTables.includes(name));
  const missingTypes = expectedTypes.filter((name) => !actualTypes.includes(name));

  if (missingTables.length || missingTypes.length) {
    throw new Error(
      `Schema incomplete. Missing tables: ${missingTables.join(", ") || "none"}; missing types: ${missingTypes.join(", ") || "none"}`,
    );
  }

  console.log("PostgreSQL schema verification passed");
} catch (error) {
  console.error("PostgreSQL schema verification failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
