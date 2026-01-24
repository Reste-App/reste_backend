-- Stayca Backend Schema
-- Hotels ranking app with Elo + sentiment scoring

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 30),
  CONSTRAINT username_format CHECK (username ~ '^[a-zA-Z0-9_]+$')
);

-- Follows table (social graph)
CREATE TABLE follows (
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);

-- Stays table (user's hotel list with status and sentiment)
CREATE TABLE stays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('WANT', 'BEEN')),
  sentiment TEXT CHECK (sentiment IN ('LIKED', 'FINE', 'DISLIKED')),
  stayed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, place_id),
  -- Sentiment validation constraints
  CONSTRAINT sentiment_required_for_been CHECK (
    (status = 'BEEN' AND sentiment IS NOT NULL) OR
    (status = 'WANT' AND sentiment IS NULL)
  )
);

CREATE INDEX idx_stays_user_id ON stays(user_id);
CREATE INDEX idx_stays_place_id ON stays(place_id);
CREATE INDEX idx_stays_status ON stays(user_id, status);

-- Posts table (stay notes/reviews)
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  text TEXT NOT NULL,
  tags TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT text_not_empty CHECK (char_length(trim(text)) > 0),
  CONSTRAINT text_max_length CHECK (char_length(text) <= 2000)
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_place_id ON posts(place_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);

-- Elo ratings table (per-user per-place rating)
CREATE TABLE elo_ratings (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  rating FLOAT8 NOT NULL DEFAULT 1500,
  games_played INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, place_id),
  CONSTRAINT rating_reasonable CHECK (rating >= 0 AND rating <= 3000),
  CONSTRAINT games_played_non_negative CHECK (games_played >= 0)
);

CREATE INDEX idx_elo_ratings_user_id ON elo_ratings(user_id);
CREATE INDEX idx_elo_ratings_rating ON elo_ratings(user_id, rating DESC);

-- Elo matches table (pairwise comparison history)
CREATE TABLE elo_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  place_a TEXT NOT NULL,
  place_b TEXT NOT NULL,
  winner_place_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT winner_is_a_or_b CHECK (winner_place_id IN (place_a, place_b))
);

CREATE INDEX idx_elo_matches_user_id ON elo_matches(user_id);
CREATE INDEX idx_elo_matches_created_at ON elo_matches(created_at DESC);

-- Feed events table (activity stream)
CREATE TABLE feed_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('FOLLOW', 'POST', 'ELO_MATCH', 'MARK_BEEN', 'WISHLIST')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feed_events_actor_id ON feed_events(actor_id);
CREATE INDEX idx_feed_events_created_at ON feed_events(created_at DESC);
CREATE INDEX idx_feed_events_type ON feed_events(event_type);

-- Place cache table (Google Places data cache)
CREATE TABLE place_cache (
  place_id TEXT PRIMARY KEY,
  details JSONB NOT NULL,
  name TEXT NOT NULL,
  chain TEXT,
  city TEXT,
  country TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT name_not_empty CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX idx_place_cache_name ON place_cache(name);
CREATE INDEX idx_place_cache_updated_at ON place_cache(updated_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stays_updated_at
  BEFORE UPDATE ON stays
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_elo_ratings_updated_at
  BEFORE UPDATE ON elo_ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
