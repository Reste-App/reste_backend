-- Placement sessions table for tracking Beli-like stopping behavior
-- Tracks when a newly added hotel is "placed" (well-ranked) vs still comparing

CREATE TABLE placement_sessions (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  comparisons_done INTEGER NOT NULL DEFAULT 0,
  last_rank_position INTEGER,
  stable_steps INTEGER NOT NULL DEFAULT 0,
  is_placed BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, place_id),
  CONSTRAINT comparisons_done_non_negative CHECK (comparisons_done >= 0),
  CONSTRAINT stable_steps_non_negative CHECK (stable_steps >= 0)
);

CREATE INDEX idx_placement_sessions_user_id ON placement_sessions(user_id);
CREATE INDEX idx_placement_sessions_active ON placement_sessions(user_id, is_placed) WHERE is_placed = FALSE;

-- Add trigger for updated_at
CREATE TRIGGER update_placement_sessions_updated_at
  BEFORE UPDATE ON placement_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to get user's current rank position for a hotel
-- Returns the 1-indexed position in the user's Elo-sorted list
CREATE OR REPLACE FUNCTION get_rank_position(
  p_user_id UUID,
  p_place_id TEXT
)
RETURNS INTEGER AS $$
DECLARE
  v_position INTEGER;
BEGIN
  SELECT position INTO v_position
  FROM (
    SELECT 
      place_id,
      ROW_NUMBER() OVER (ORDER BY rating DESC) as position
    FROM elo_ratings
    WHERE user_id = p_user_id
  ) ranked
  WHERE place_id = p_place_id;
  
  RETURN COALESCE(v_position, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to update placement session after a comparison
-- Returns whether the hotel is now placed (stopping criteria met)
CREATE OR REPLACE FUNCTION update_placement_session(
  p_user_id UUID,
  p_place_id TEXT,
  p_max_comparisons INTEGER DEFAULT 4,
  p_stable_threshold INTEGER DEFAULT 2
)
RETURNS JSON AS $$
DECLARE
  v_current_rank INTEGER;
  v_prev_rank INTEGER;
  v_comparisons INTEGER;
  v_stable_steps INTEGER;
  v_is_placed BOOLEAN;
  v_rank_changed BOOLEAN;
BEGIN
  -- Get current rank position
  v_current_rank := get_rank_position(p_user_id, p_place_id);
  
  -- Get or create placement session
  INSERT INTO placement_sessions (user_id, place_id, comparisons_done, last_rank_position, stable_steps, is_placed)
  VALUES (p_user_id, p_place_id, 0, NULL, 0, FALSE)
  ON CONFLICT (user_id, place_id) DO NOTHING;
  
  -- Fetch current session state
  SELECT comparisons_done, last_rank_position, stable_steps, is_placed
  INTO v_comparisons, v_prev_rank, v_stable_steps, v_is_placed
  FROM placement_sessions
  WHERE user_id = p_user_id AND place_id = p_place_id
  FOR UPDATE;
  
  -- If already placed, return early
  IF v_is_placed THEN
    RETURN json_build_object(
      'is_placed', TRUE,
      'comparisons_done', v_comparisons,
      'rank_position', v_current_rank,
      'stable_steps', v_stable_steps
    );
  END IF;
  
  -- Increment comparisons
  v_comparisons := v_comparisons + 1;
  
  -- Check if rank position changed
  v_rank_changed := v_prev_rank IS NOT NULL AND v_prev_rank != v_current_rank;
  
  -- Update stable steps
  IF v_rank_changed THEN
    v_stable_steps := 0;  -- Reset on rank change
  ELSE
    v_stable_steps := v_stable_steps + 1;
  END IF;
  
  -- Check stopping criteria:
  -- 1) Hard cap on comparisons
  -- 2) Stable steps threshold (rank didn't change N times)
  v_is_placed := (v_comparisons >= p_max_comparisons) OR (v_stable_steps >= p_stable_threshold);
  
  -- Update session
  UPDATE placement_sessions
  SET 
    comparisons_done = v_comparisons,
    last_rank_position = v_current_rank,
    stable_steps = v_stable_steps,
    is_placed = v_is_placed,
    updated_at = NOW()
  WHERE user_id = p_user_id AND place_id = p_place_id;
  
  RETURN json_build_object(
    'is_placed', v_is_placed,
    'comparisons_done', v_comparisons,
    'rank_position', v_current_rank,
    'stable_steps', v_stable_steps,
    'rank_changed', v_rank_changed
  );
END;
$$ LANGUAGE plpgsql;

-- RLS policies for placement_sessions
ALTER TABLE placement_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own placement sessions"
  ON placement_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own placement sessions"
  ON placement_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own placement sessions"
  ON placement_sessions FOR UPDATE
  USING (auth.uid() = user_id);
