-- Add added_via column to parts table
-- Tracks how each part was added: manual, quick-add-url, csv-import, invoice-import, mouser-history, component-library
ALTER TABLE parts ADD COLUMN IF NOT EXISTS added_via TEXT DEFAULT NULL;
