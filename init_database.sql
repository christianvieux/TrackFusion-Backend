-- ENUMS
DO $$ BEGIN
  CREATE TYPE public.category_enum AS ENUM (
    'Music', 'Sound Effect', 'Voice Over', 'Ambience', 'Other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.genre_enum AS ENUM (
    'Pop', 'Rock', 'Hip Hop', 'Electronic', 'Classical', 'Jazz',
    'R&B', 'Country', 'Folk', 'Metal', 'Blues', 'Reggae',
    'World', 'Latin', 'Alternative', 'Indie'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.mood_enum AS ENUM (
    'Happy', 'Sad', 'Energetic', 'Calm', 'Angry', 'Romantic',
    'Dark', 'Epic', 'Funny', 'Dramatic', 'Mysterious',
    'Peaceful', 'Tense'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- SEQUENCES
CREATE SEQUENCE IF NOT EXISTS users_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS tracks_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS playlists_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS track_interactions_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS user_favorite_tracks_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS user_tokens_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS password_reset_tokens_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS otp_codes_id_seq START 1;

-- TABLES
CREATE TABLE IF NOT EXISTS public.users (
  id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
  username varchar(255) NOT NULL,
  email varchar(255) NOT NULL,
  password_hash varchar(255) NOT NULL,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
  profile_picture_url text,
  is_verified boolean DEFAULT false,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_username_key UNIQUE (username)
);

CREATE TABLE IF NOT EXISTS public.tracks (
  id integer NOT NULL DEFAULT nextval('tracks_id_seq'::regclass),
  name varchar(255) NOT NULL,
  artist varchar(255),
  description text,
  is_private boolean DEFAULT false,
  category category_enum,
  genre genre_enum[] DEFAULT '{}'::genre_enum[],
  mood mood_enum[] DEFAULT '{}'::mood_enum[],
  length integer,
  bpm integer,
  image_url text,
  url text NOT NULL,
  creator_id integer,
  sound_type varchar(50),
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tracks_pkey PRIMARY KEY (id),
  CONSTRAINT tracks_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.playlists (
  id integer NOT NULL DEFAULT nextval('playlists_id_seq'::regclass),
  name varchar(255) NOT NULL,
  description text,
  creator_id integer,
  is_private boolean DEFAULT false,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT playlists_pkey PRIMARY KEY (id),
  CONSTRAINT playlists_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.playlist_tracks (
  playlist_id integer NOT NULL,
  track_id integer NOT NULL,
  "position" integer NOT NULL,
  added_at timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT playlist_tracks_pkey PRIMARY KEY (playlist_id, track_id),
  CONSTRAINT playlist_tracks_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE,
  CONSTRAINT playlist_tracks_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.track_interactions (
  id integer NOT NULL DEFAULT nextval('track_interactions_id_seq'::regclass),
  track_id integer,
  user_id integer,
  is_favorite boolean DEFAULT false,
  play_count integer DEFAULT 0,
  last_played timestamp,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
  interaction_type varchar(50),
  CONSTRAINT track_interactions_pkey PRIMARY KEY (id),
  CONSTRAINT track_interactions_track_id_user_id_key UNIQUE (track_id, user_id),
  CONSTRAINT track_interactions_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.tracks(id) ON DELETE CASCADE,
  CONSTRAINT track_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.user_favorite_tracks (
  id integer NOT NULL DEFAULT nextval('user_favorite_tracks_id_seq'::regclass),
  user_id integer,
  track_id integer,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_favorite_tracks_pkey PRIMARY KEY (id),
  CONSTRAINT user_favorite_tracks_user_id_track_id_key UNIQUE (user_id, track_id),
  CONSTRAINT user_favorite_tracks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_favorite_tracks_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.user_tokens (
  id integer NOT NULL DEFAULT nextval('user_tokens_id_seq'::regclass),
  user_id integer,
  token varchar(255) NOT NULL,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp NOT NULL,
  CONSTRAINT user_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT user_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id integer NOT NULL DEFAULT nextval('password_reset_tokens_id_seq'::regclass),
  user_id integer NOT NULL,
  token_hash text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp NOT NULL,
  CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.otp_codes (
  id integer NOT NULL DEFAULT nextval('otp_codes_id_seq'::regclass),
  email varchar(255) NOT NULL,
  code_hash text NOT NULL,
  purpose varchar(50) NOT NULL,
  is_valid boolean NOT NULL DEFAULT true,
  used boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp NOT NULL,
  CONSTRAINT valid_purposes CHECK (purpose = 'registration'),
  CONSTRAINT otp_codes_pkey PRIMARY KEY (id)
);

-- Rerunnable token-storage migration for databases created by older releases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'password_reset_tokens'
       AND column_name = 'token'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'password_reset_tokens'
       AND column_name = 'token_hash'
  ) THEN
    ALTER TABLE public.password_reset_tokens RENAME COLUMN token TO token_hash;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'otp_codes'
       AND column_name = 'code'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'otp_codes'
       AND column_name = 'code_hash'
  ) THEN
    ALTER TABLE public.otp_codes RENAME COLUMN code TO code_hash;
  END IF;
END $$;

ALTER TABLE public.password_reset_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamp;
UPDATE public.password_reset_tokens
   SET expires_at = created_at + INTERVAL '15 minutes'
 WHERE expires_at IS NULL;
UPDATE public.password_reset_tokens
   SET token_hash = encode(sha256(token_hash::bytea), 'hex'), used = TRUE
 WHERE token_hash !~ '^[0-9a-f]{64}$';
ALTER TABLE public.password_reset_tokens
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ALTER COLUMN code_hash TYPE text;
DELETE FROM public.otp_codes WHERE purpose <> 'registration';
ALTER TABLE public.otp_codes DROP CONSTRAINT IF EXISTS valid_purposes;
ALTER TABLE public.otp_codes
  ADD CONSTRAINT valid_purposes CHECK (purpose = 'registration');
UPDATE public.otp_codes
   SET code_hash = encode(sha256(code_hash::bytea), 'hex'),
       is_valid = FALSE,
       used = TRUE
 WHERE code_hash !~ '^[0-9a-f]{64}$';
UPDATE public.otp_codes
   SET is_valid = COALESCE(is_valid, FALSE),
       used = COALESCE(used, FALSE),
       attempts = COALESCE(attempts, 0);
ALTER TABLE public.otp_codes
  ALTER COLUMN is_valid SET NOT NULL,
  ALTER COLUMN used SET NOT NULL,
  ALTER COLUMN attempts SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

-- OWNED BY (for cleanup consistency)
ALTER SEQUENCE users_id_seq OWNED BY users.id;
ALTER SEQUENCE tracks_id_seq OWNED BY tracks.id;
ALTER SEQUENCE playlists_id_seq OWNED BY playlists.id;
ALTER SEQUENCE track_interactions_id_seq OWNED BY track_interactions.id;
ALTER SEQUENCE user_favorite_tracks_id_seq OWNED BY user_favorite_tracks.id;
ALTER SEQUENCE user_tokens_id_seq OWNED BY user_tokens.id;
ALTER SEQUENCE password_reset_tokens_id_seq OWNED BY password_reset_tokens.id;
ALTER SEQUENCE otp_codes_id_seq OWNED BY otp_codes.id;

-- INDEXES
CREATE INDEX IF NOT EXISTS tracks_creator_id_idx ON public.tracks (creator_id);
CREATE INDEX IF NOT EXISTS track_interactions_user_id_idx ON public.track_interactions (user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON public.password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS otp_codes_lookup_idx ON public.otp_codes (email, purpose, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_one_active_idx
  ON public.password_reset_tokens (user_id) WHERE used = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS otp_codes_one_active_idx
  ON public.otp_codes (email, purpose) WHERE is_valid = TRUE AND used = FALSE;
