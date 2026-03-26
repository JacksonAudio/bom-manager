-- Add is_domestic flag to vendors table
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_domestic BOOLEAN DEFAULT TRUE;

-- Set known international vendors
UPDATE vendors SET is_domestic = FALSE WHERE slug IN ('lcsc');

-- All others default to TRUE (domestic/US-based)
