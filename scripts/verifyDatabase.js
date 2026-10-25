import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to verify the database");
  process.exit(1);
}

const expectedColumns = {
  users: [
    "id",
    "username",
    "email",
    "password_hash",
    "created_at",
    "updated_at",
    "profile_picture_url",
    "is_verified",
  ],
  tracks: [
    "id",
    "name",
    "artist",
    "description",
    "is_private",
    "category",
    "genre",
    "mood",
    "length",
    "bpm",
    "image_url",
    "url",
    "creator_id",
    "sound_type",
    "created_at",
    "updated_at",
  ],
  playlists: [
    "id",
    "name",
    "description",
    "creator_id",
    "is_private",
    "created_at",
    "updated_at",
  ],
  playlist_tracks: ["playlist_id", "track_id", "position", "added_at"],
  track_interactions: [
    "id",
    "track_id",
    "user_id",
    "is_favorite",
    "play_count",
    "last_played",
    "created_at",
    "updated_at",
    "interaction_type",
  ],
  user_favorite_tracks: ["id", "user_id", "track_id", "created_at"],
  user_tokens: ["id", "user_id", "token", "created_at", "expires_at"],
  password_reset_tokens: ["id", "user_id", "token", "used", "created_at"],
  otp_codes: [
    "id",
    "email",
    "code",
    "purpose",
    "is_valid",
    "used",
    "created_at",
    "expires_at",
  ],
};

const expectedEnumLabels = {
  category_enum: ["Music", "Sound Effect", "Voice Over", "Ambience", "Other"],
  genre_enum: [
    "Pop",
    "Rock",
    "Hip Hop",
    "Electronic",
    "Classical",
    "Jazz",
    "R&B",
    "Country",
    "Folk",
    "Metal",
    "Blues",
    "Reggae",
    "World",
    "Latin",
    "Alternative",
    "Indie",
  ],
  mood_enum: [
    "Happy",
    "Sad",
    "Energetic",
    "Calm",
    "Angry",
    "Romantic",
    "Dark",
    "Epic",
    "Funny",
    "Dramatic",
    "Mysterious",
    "Peaceful",
    "Tense",
  ],
};

const expectedTables = Object.keys(expectedColumns);
const expectedTypes = Object.keys(expectedEnumLabels);
const expectedSequences = [
  "users_id_seq",
  "tracks_id_seq",
  "playlists_id_seq",
  "track_interactions_id_seq",
  "user_favorite_tracks_id_seq",
  "user_tokens_id_seq",
  "password_reset_tokens_id_seq",
  "otp_codes_id_seq",
];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const [tableResult, columnResult, typeResult, sequenceResult] = await Promise.all([
    pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [expectedTables],
    ),
    pool.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        ORDER BY table_name, ordinal_position`,
      [expectedTables],
    ),
    pool.query(
      `SELECT type_info.typname, enum_value.enumlabel
         FROM pg_type AS type_info
         JOIN pg_namespace AS namespace ON namespace.oid = type_info.typnamespace
         JOIN pg_enum AS enum_value ON enum_value.enumtypid = type_info.oid
        WHERE namespace.nspname = 'public' AND type_info.typname = ANY($1::text[])
        ORDER BY type_info.typname, enum_value.enumsortorder`,
      [expectedTypes],
    ),
    pool.query(
      `SELECT sequence_name
         FROM information_schema.sequences
        WHERE sequence_schema = 'public' AND sequence_name = ANY($1::text[])
        ORDER BY sequence_name`,
      [expectedSequences],
    ),
  ]);

  const actualTables = new Set(tableResult.rows.map(({ table_name }) => table_name));
  const actualColumns = new Set(
    columnResult.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
  );
  const actualSequences = new Set(
    sequenceResult.rows.map(({ sequence_name }) => sequence_name),
  );
  const actualEnumLabels = new Map();
  for (const { typname, enumlabel } of typeResult.rows) {
    if (!actualEnumLabels.has(typname)) {
      actualEnumLabels.set(typname, new Set());
    }
    actualEnumLabels.get(typname).add(enumlabel);
  }

  const missingTables = expectedTables.filter((name) => !actualTables.has(name));
  const missingColumns = Object.entries(expectedColumns).flatMap(([tableName, columns]) =>
    actualTables.has(tableName)
      ? columns
          .filter((columnName) => !actualColumns.has(`${tableName}.${columnName}`))
          .map((columnName) => `${tableName}.${columnName}`)
      : [],
  );
  const missingTypes = expectedTypes.filter((name) => !actualEnumLabels.has(name));
  const missingEnumLabels = Object.entries(expectedEnumLabels).flatMap(
    ([typeName, labels]) =>
      actualEnumLabels.has(typeName)
        ? labels
            .filter((label) => !actualEnumLabels.get(typeName).has(label))
            .map((label) => `${typeName}.${label}`)
        : [],
  );
  const missingSequences = expectedSequences.filter((name) => !actualSequences.has(name));

  const problems = [
    ["tables", missingTables],
    ["columns", missingColumns],
    ["enum types", missingTypes],
    ["enum labels", missingEnumLabels],
    ["sequences", missingSequences],
  ].filter(([, missing]) => missing.length > 0);

  if (problems.length > 0) {
    throw new Error(
      `Schema is incompatible: ${problems
        .map(([kind, missing]) => `missing ${kind}: ${missing.join(", ")}`)
        .join("; ")}`,
    );
  }

  console.log("PostgreSQL schema compatibility verification passed");
} catch (error) {
  console.error("PostgreSQL schema verification failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
