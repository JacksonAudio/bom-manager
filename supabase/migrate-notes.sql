-- Add notes column to parts table
-- Stores free-form notes; used for AliExpress purchase URLs and other per-part annotations
ALTER TABLE parts ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
