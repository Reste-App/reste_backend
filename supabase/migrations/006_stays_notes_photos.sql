-- Add notes and photos columns to stays table
ALTER TABLE stays ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE stays ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT '{}';

-- Add comment explaining the columns
COMMENT ON COLUMN stays.notes IS 'User notes about their stay';
COMMENT ON COLUMN stays.photos IS 'Array of photo URLs uploaded by the user';
