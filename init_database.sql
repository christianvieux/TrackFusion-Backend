-- ENUMS
CREATE TYPE public.category_enum AS ENUM (
  'Music', 'Sound Effect', 'Voice Over', 'Ambience', 'Other'
);

CREATE TYPE public.genre_enum AS ENUM (
  'Pop', 'Rock', 'Hip Hop', 'Electronic', 'Classical', 'Jazz',
  'R&B', 'Country', 'Folk', 'Metal', 'Blues', 'Reggae',
  'World', 'Latin', 'Alternative', 'Indie'
);

CREATE TYPE public.mood_enum AS ENUM (
  'Happy', 'Sad', 'Energetic', 'Calm', 'Angry', 'Romantic',
  'Dark', 'Epic', 'Funny', 'Dramatic', 'Mysterious',
  'Peaceful', 'Tense'
);

-- SEQUENCES
CREATE SEQUENCE users_id_seq START 1;
CREATE SEQUENCE tracks_id_seq START 1;
CREATE SEQUENCE playlists_id_seq START 1;
CREATE SEQUENCE track_interactions_id_seq START 1;
CREATE SEQUENCE user_favorite_tracks_id_seq START 1;
CREATE SEQUENCE user_tokens_id_seq START 1;
CREATE SEQUENCE otp_codes_id_seq START 1;

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

CREATE TABLE IF NOT EXISTS public.otp_codes (
  id integer NOT NULL DEFAULT nextval('otp_codes_id_seq'::regclass),
  email varchar(255) NOT NULL,
  code varchar(6) NOT NULL,
  purpose varchar(50) NOT NULL,
  is_valid boolean DEFAULT true,
  used boolean DEFAULT false,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamp NOT NULL,
  CONSTRAINT valid_purposes CHECK (purpose IN ('registration', 'reset_password', 'verification')),
  CONSTRAINT otp_codes_pkey PRIMARY KEY (id)
);

-- OWNED BY (for cleanup consistency)
ALTER SEQUENCE users_id_seq OWNED BY users.id;
ALTER SEQUENCE tracks_id_seq OWNED BY tracks.id;
ALTER SEQUENCE playlists_id_seq OWNED BY playlists.id;
ALTER SEQUENCE track_interactions_id_seq OWNED BY track_interactions.id;
ALTER SEQUENCE user_favorite_tracks_id_seq OWNED BY user_favorite_tracks.id;
ALTER SEQUENCE user_tokens_id_seq OWNED BY user_tokens.id;
ALTER SEQUENCE otp_codes_id_seq OWNED BY otp_codes.id;
