-- Backfill display_score for all elo_ratings that are missing it
-- Uses tier-percentile scoring based on Elo rating

-- Tier thresholds (from utils.ts):
--   LIKED: rating >= 1525
--   FINE: rating >= 1475 AND < 1525
--   DISLIKED: rating < 1475

-- Display score bands:
--   LIKED: 6.7 - 10.0
--   FINE: 3.4 - 6.7
--   DISLIKED: 0.0 - 3.4

WITH tier_rankings AS (
  SELECT 
    er.user_id,
    er.place_id,
    er.rating,
    -- Determine sentiment tier based on rating
    CASE 
      WHEN er.rating >= 1525 THEN 'LIKED'
      WHEN er.rating >= 1475 THEN 'FINE'
      ELSE 'DISLIKED'
    END AS tier,
    -- Rank within tier (0-indexed, ascending by rating)
    ROW_NUMBER() OVER (
      PARTITION BY er.user_id, 
        CASE 
          WHEN er.rating >= 1525 THEN 'LIKED'
          WHEN er.rating >= 1475 THEN 'FINE'
          ELSE 'DISLIKED'
        END
      ORDER BY er.rating ASC
    ) - 1 AS rank_in_tier,
    -- Count in tier
    COUNT(*) OVER (
      PARTITION BY er.user_id,
        CASE 
          WHEN er.rating >= 1525 THEN 'LIKED'
          WHEN er.rating >= 1475 THEN 'FINE'
          ELSE 'DISLIKED'
        END
    ) AS total_in_tier
  FROM elo_ratings er
  WHERE er.display_score IS NULL
),
computed_scores AS (
  SELECT 
    user_id,
    place_id,
    tier,
    rank_in_tier,
    total_in_tier,
    -- Compute percentile: p = rank / max(1, n-1)
    CASE 
      WHEN total_in_tier <= 1 THEN 0.5
      ELSE rank_in_tier::FLOAT / (total_in_tier - 1)::FLOAT
    END AS percentile,
    -- Compute display score based on tier band
    ROUND(
      CASE tier
        WHEN 'LIKED' THEN 
          6.7 + (CASE WHEN total_in_tier <= 1 THEN 0.5 ELSE rank_in_tier::FLOAT / (total_in_tier - 1)::FLOAT END) * 3.3
        WHEN 'FINE' THEN 
          3.4 + (CASE WHEN total_in_tier <= 1 THEN 0.5 ELSE rank_in_tier::FLOAT / (total_in_tier - 1)::FLOAT END) * 3.3
        ELSE -- DISLIKED
          0.0 + (CASE WHEN total_in_tier <= 1 THEN 0.5 ELSE rank_in_tier::FLOAT / (total_in_tier - 1)::FLOAT END) * 3.4
      END::NUMERIC,
      1
    )::FLOAT8 AS display_score
  FROM tier_rankings
)
UPDATE elo_ratings er
SET display_score = cs.display_score
FROM computed_scores cs
WHERE er.user_id = cs.user_id 
  AND er.place_id = cs.place_id
  AND er.display_score IS NULL;

-- Log how many were updated
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled display_score for % elo_ratings records', updated_count;
END $$;
