-- Vibe Check Tables Migration
-- Stores user vibe responses and AI-generated summaries

-- Store individual vibe check responses from users
CREATE TABLE IF NOT EXISTS vibe_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  category_id TEXT NOT NULL, -- 'vibe', 'bedding', 'view', 'cleanliness', etc.
  sentiment TEXT NOT NULL CHECK (sentiment IN ('good', 'fine', 'bad')),
  response_text TEXT NOT NULL,
  input_method TEXT DEFAULT 'text' CHECK (input_method IN ('voice', 'text')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow multiple responses per user per place per category (e.g., multiple stays)
-- But create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_vibe_responses_place ON vibe_responses(place_id);
CREATE INDEX IF NOT EXISTS idx_vibe_responses_user ON vibe_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_vibe_responses_category ON vibe_responses(place_id, category_id);

-- Store AI-generated summaries per hotel (cached)
CREATE TABLE IF NOT EXISTS vibe_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT NOT NULL UNIQUE,
  summary_text TEXT NOT NULL, -- AI-generated overall summary
  total_responses INTEGER DEFAULT 0,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of category data with sentiment %
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vibe_summaries_place ON vibe_summaries(place_id);
CREATE INDEX IF NOT EXISTS idx_vibe_summaries_expires ON vibe_summaries(expires_at);

-- RLS Policies for vibe_responses
ALTER TABLE vibe_responses ENABLE ROW LEVEL SECURITY;

-- Users can read all vibe responses (public for aggregation)
CREATE POLICY "Anyone can read vibe responses"
  ON vibe_responses FOR SELECT
  USING (true);

-- Users can insert their own responses
CREATE POLICY "Users can insert own vibe responses"
  ON vibe_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own responses
CREATE POLICY "Users can update own vibe responses"
  ON vibe_responses FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own responses
CREATE POLICY "Users can delete own vibe responses"
  ON vibe_responses FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for vibe_summaries
ALTER TABLE vibe_summaries ENABLE ROW LEVEL SECURITY;

-- Anyone can read summaries (public cache)
CREATE POLICY "Anyone can read vibe summaries"
  ON vibe_summaries FOR SELECT
  USING (true);

-- Only service role can insert/update summaries (via edge function)
-- No INSERT/UPDATE policies for regular users - edge function uses service role
