-- Create hotels table for Amex hotel data
CREATE TABLE IF NOT EXISTS hotels (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  google_place_id TEXT UNIQUE NOT NULL,
  program TEXT,
  credit TEXT,
  early_checkin TEXT,
  free_breakfast TEXT,
  free_wifi TEXT,
  late_checkout TEXT,
  room_upgrade TEXT,
  price_calendar TEXT,
  amex_reservation TEXT,
  hotelft_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on google_place_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_hotels_google_place_id ON hotels(google_place_id);

-- Create index on name for search
CREATE INDEX IF NOT EXISTS idx_hotels_name ON hotels USING gin(to_tsvector('english', name));

-- Enable Row Level Security
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all authenticated users to read hotels
CREATE POLICY "Allow authenticated users to read hotels"
ON hotels FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow service role to insert/update/delete hotels
CREATE POLICY "Allow service role to manage hotels"
ON hotels FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Add comment to table
COMMENT ON TABLE hotels IS 'Amex Fine Hotels & Resorts database with Google Place IDs';
COMMENT ON COLUMN hotels.google_place_id IS 'Google Places API place ID for fetching live details';
COMMENT ON COLUMN hotels.program IS 'Amex program type (FHR or other)';
COMMENT ON COLUMN hotels.credit IS 'Property credit details';
COMMENT ON COLUMN hotels.early_checkin IS 'Early check-in benefit';
COMMENT ON COLUMN hotels.free_breakfast IS 'Breakfast benefit details';
COMMENT ON COLUMN hotels.free_wifi IS 'WiFi benefit details';
COMMENT ON COLUMN hotels.late_checkout IS 'Late checkout benefit details';
COMMENT ON COLUMN hotels.room_upgrade IS 'Room upgrade benefit details';
