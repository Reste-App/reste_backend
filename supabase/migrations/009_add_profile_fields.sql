-- Add full_name, home_city, and bio columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS home_city TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;

-- Add comments explaining the columns
COMMENT ON COLUMN profiles.full_name IS 'User''s full display name';
COMMENT ON COLUMN profiles.home_city IS 'User''s home city';
COMMENT ON COLUMN profiles.bio IS 'User''s profile bio/description';
