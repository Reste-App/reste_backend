-- RLS Policies for Stayca Backend
-- All tables require authentication; most are readable by all, writable by owner

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE stays ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE elo_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE elo_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_cache ENABLE ROW LEVEL SECURITY;

-- Profiles policies
-- Readable by all authenticated users
CREATE POLICY "Profiles are viewable by authenticated users"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can insert their own profile
CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Follows policies
-- Readable by all authenticated users
CREATE POLICY "Follows are viewable by authenticated users"
  ON follows FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can follow others (insert their own follows)
CREATE POLICY "Users can follow others"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

-- Users can unfollow (delete their own follows)
CREATE POLICY "Users can unfollow"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id);

-- Stays policies
-- Readable by all authenticated users (hackathon simplicity)
CREATE POLICY "Stays are viewable by authenticated users"
  ON stays FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can manage their own stays
CREATE POLICY "Users can insert their own stays"
  ON stays FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own stays"
  ON stays FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own stays"
  ON stays FOR DELETE
  USING (auth.uid() = user_id);

-- Posts policies
-- Readable by all authenticated users
CREATE POLICY "Posts are viewable by authenticated users"
  ON posts FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can create their own posts
CREATE POLICY "Users can insert their own posts"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own posts
CREATE POLICY "Users can update their own posts"
  ON posts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own posts
CREATE POLICY "Users can delete their own posts"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

-- Elo ratings policies
-- Readable by all authenticated users
CREATE POLICY "Elo ratings are viewable by authenticated users"
  ON elo_ratings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can manage their own ratings
CREATE POLICY "Users can insert their own elo ratings"
  ON elo_ratings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own elo ratings"
  ON elo_ratings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Elo matches policies
-- Readable by all authenticated users
CREATE POLICY "Elo matches are viewable by authenticated users"
  ON elo_matches FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can insert their own matches
CREATE POLICY "Users can insert their own elo matches"
  ON elo_matches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Feed events policies
-- Readable by all authenticated users
CREATE POLICY "Feed events are viewable by authenticated users"
  ON feed_events FOR SELECT
  USING (auth.role() = 'authenticated');

-- Insert only via service role (edge functions)
-- No user-facing insert policy - handled by edge functions with service key

-- Place cache policies
-- Readable by all authenticated users
CREATE POLICY "Place cache is viewable by authenticated users"
  ON place_cache FOR SELECT
  USING (auth.role() = 'authenticated');

-- Insert/update only via service role (edge functions)
-- No user-facing write policies - handled by edge functions with service key
