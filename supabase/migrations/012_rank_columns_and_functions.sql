-- Add rank_in_tier columns to stays table for new ranking system
ALTER TABLE stays ADD COLUMN IF NOT EXISTS rank_in_tier INTEGER;
ALTER TABLE stays ADD COLUMN IF NOT EXISTS rank_updated_at TIMESTAMPTZ;

-- Unique rank within (user_id, sentiment) for placed hotels
CREATE UNIQUE INDEX IF NOT EXISTS idx_stays_rank_in_tier
  ON stays (user_id, sentiment, rank_in_tier)
  WHERE rank_in_tier IS NOT NULL;

-- Fast lookup for tier queries
CREATE INDEX IF NOT EXISTS idx_stays_tier_rank
  ON stays (user_id, sentiment, rank_in_tier)
  WHERE status = 'BEEN' AND rank_in_tier IS NOT NULL;

-- =============================================================================
-- RPC: rank_finalize_placement
-- Atomically shifts existing hotels up and inserts the new hotel at the given rank.
-- =============================================================================
CREATE OR REPLACE FUNCTION rank_finalize_placement(
  p_user_id UUID,
  p_place_id TEXT,
  p_sentiment TEXT,
  p_rank_in_tier INTEGER
)
RETURNS VOID AS $$
BEGIN
  -- Shift all hotels at rank >= insertion point up by 1
  UPDATE stays
  SET rank_in_tier = rank_in_tier + 1
  WHERE user_id = p_user_id
    AND sentiment = p_sentiment
    AND status = 'BEEN'
    AND rank_in_tier IS NOT NULL
    AND rank_in_tier >= p_rank_in_tier;

  -- Assign rank to the new hotel
  UPDATE stays
  SET rank_in_tier = p_rank_in_tier,
      rank_updated_at = NOW()
  WHERE user_id = p_user_id
    AND place_id = p_place_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- RPC: rank_reset_placement
-- Clears a hotel's rank and shifts all hotels above it down by 1.
-- =============================================================================
CREATE OR REPLACE FUNCTION rank_reset_placement(
  p_user_id UUID,
  p_place_id TEXT,
  p_sentiment TEXT,
  p_old_rank INTEGER
)
RETURNS VOID AS $$
BEGIN
  -- Clear the rank
  UPDATE stays
  SET rank_in_tier = NULL,
      rank_updated_at = NOW()
  WHERE user_id = p_user_id
    AND place_id = p_place_id;

  -- Shift hotels above the removed rank down by 1
  UPDATE stays
  SET rank_in_tier = rank_in_tier - 1
  WHERE user_id = p_user_id
    AND sentiment = p_sentiment
    AND status = 'BEEN'
    AND rank_in_tier IS NOT NULL
    AND rank_in_tier > p_old_rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
