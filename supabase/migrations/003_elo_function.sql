-- PostgreSQL function for atomic Elo rating updates
-- Called from elo-submit-match edge function

CREATE OR REPLACE FUNCTION update_elo_ratings(
  p_user_id UUID,
  p_place_a TEXT,
  p_place_b TEXT,
  p_winner TEXT,
  p_k_factor FLOAT8 DEFAULT 24
)
RETURNS JSON AS $$
DECLARE
  v_rating_a FLOAT8;
  v_rating_b FLOAT8;
  v_games_a INT;
  v_games_b INT;
  v_expected_a FLOAT8;
  v_expected_b FLOAT8;
  v_score_a FLOAT8;
  v_score_b FLOAT8;
  v_new_rating_a FLOAT8;
  v_new_rating_b FLOAT8;
BEGIN
  -- Lock and fetch ratings for both places (insert if not exists)
  INSERT INTO elo_ratings (user_id, place_id, rating, games_played)
  VALUES (p_user_id, p_place_a, 1500, 0)
  ON CONFLICT (user_id, place_id) DO NOTHING;
  
  INSERT INTO elo_ratings (user_id, place_id, rating, games_played)
  VALUES (p_user_id, p_place_b, 1500, 0)
  ON CONFLICT (user_id, place_id) DO NOTHING;
  
  -- Fetch current ratings with row lock
  SELECT rating, games_played INTO v_rating_a, v_games_a
  FROM elo_ratings
  WHERE user_id = p_user_id AND place_id = p_place_a
  FOR UPDATE;
  
  SELECT rating, games_played INTO v_rating_b, v_games_b
  FROM elo_ratings
  WHERE user_id = p_user_id AND place_id = p_place_b
  FOR UPDATE;
  
  -- Calculate expected scores
  v_expected_a := 1.0 / (1.0 + POWER(10, (v_rating_b - v_rating_a) / 400.0));
  v_expected_b := 1.0 / (1.0 + POWER(10, (v_rating_a - v_rating_b) / 400.0));
  
  -- Actual scores
  IF p_winner = p_place_a THEN
    v_score_a := 1.0;
    v_score_b := 0.0;
  ELSE
    v_score_a := 0.0;
    v_score_b := 1.0;
  END IF;
  
  -- Calculate new ratings
  v_new_rating_a := v_rating_a + p_k_factor * (v_score_a - v_expected_a);
  v_new_rating_b := v_rating_b + p_k_factor * (v_score_b - v_expected_b);
  
  -- Update ratings
  UPDATE elo_ratings
  SET rating = v_new_rating_a,
      games_played = v_games_a + 1,
      updated_at = NOW()
  WHERE user_id = p_user_id AND place_id = p_place_a;
  
  UPDATE elo_ratings
  SET rating = v_new_rating_b,
      games_played = v_games_b + 1,
      updated_at = NOW()
  WHERE user_id = p_user_id AND place_id = p_place_b;
  
  -- Return results
  RETURN json_build_object(
    'place_a', json_build_object(
      'place_id', p_place_a,
      'old_rating', v_rating_a,
      'new_rating', v_new_rating_a,
      'games_played', v_games_a + 1
    ),
    'place_b', json_build_object(
      'place_id', p_place_b,
      'old_rating', v_rating_b,
      'new_rating', v_new_rating_b,
      'games_played', v_games_b + 1
    )
  );
END;
$$ LANGUAGE plpgsql;
