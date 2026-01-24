-- Add display_score column to elo_ratings table
-- This stores the tier-percentile display score (0.0-10.0) for efficient reads

ALTER TABLE elo_ratings 
ADD COLUMN IF NOT EXISTS display_score FLOAT8;

-- Add index for efficient sorting by display_score
CREATE INDEX IF NOT EXISTS idx_elo_ratings_display_score 
ON elo_ratings (user_id, display_score DESC);

-- Comment for documentation
COMMENT ON COLUMN elo_ratings.display_score IS 
'Cached tier-percentile display score (0.0-10.0). Updated on rating changes.';
