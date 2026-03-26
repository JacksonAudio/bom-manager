-- Add country_of_origin and hts_code columns to parts table
-- country_of_origin: editable by user, also auto-populated from DigiKey/Mouser pricing APIs
-- hts_code: US HTS code from Mouser ProductCompliance (for tariff lookups)
ALTER TABLE parts ADD COLUMN IF NOT EXISTS country_of_origin TEXT DEFAULT NULL;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS hts_code TEXT DEFAULT NULL;
