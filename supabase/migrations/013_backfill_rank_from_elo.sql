-- Backfill rank_in_tier from existing elo_ratings.
-- Converts Elo ratings into 0-indexed rank positions per (user, sentiment) tier,
-- ordered by rating ascending (lowest Elo = rank 0, highest = rank n-1).
UPDATE stays s
SET rank_in_tier = r.elo_rank,
    rank_updated_at = NOW()
FROM (
  SELECT
    s2.user_id,
    s2.place_id,
    ROW_NUMBER() OVER (
      PARTITION BY s2.user_id, s2.sentiment
      ORDER BY er.rating ASC
    ) - 1 AS elo_rank
  FROM stays s2
  JOIN elo_ratings er ON er.user_id = s2.user_id AND er.place_id = s2.place_id
  WHERE s2.status = 'BEEN' AND s2.sentiment IS NOT NULL
) r
WHERE s.user_id = r.user_id AND s.place_id = r.place_id;
