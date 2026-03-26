-- Vendor directory table — stores editable contact/account info for all suppliers
CREATE TABLE IF NOT EXISTS vendors (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,   -- matches preferred_supplier / SUPPLIERS.id values
  display_name  TEXT NOT NULL,
  website       TEXT,
  account_number TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  payment_terms TEXT,                   -- e.g. "Net 30", "Net 60", "Credit Card"
  lead_time_days INTEGER,               -- manually set default lead time in days
  notes         TEXT,
  is_api_supplier BOOLEAN DEFAULT FALSE,
  is_locked_supplier BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed known suppliers
INSERT INTO vendors (slug, display_name, website, is_api_supplier, is_locked_supplier) VALUES
  ('mouser',       'Mouser Electronics',   'https://www.mouser.com',       TRUE,  FALSE),
  ('digikey',      'Digi-Key Electronics', 'https://www.digikey.com',      TRUE,  FALSE),
  ('arrow',        'Arrow Electronics',    'https://www.arrow.com',        TRUE,  FALSE),
  ('ti',           'Texas Instruments',    'https://www.ti.com',           TRUE,  FALSE),
  ('allied',       'Allied Electronics',   'https://www.alliedelec.com',   TRUE,  FALSE),
  ('lcsc',         'LCSC Electronics',     'https://www.lcsc.com',         TRUE,  FALSE),
  ('ce dist',      'CE Distribution',      'https://www.cedist.com',       FALSE, TRUE),
  ('bolt depot',   'Bolt Depot',           'https://www.boltdepot.com',    FALSE, TRUE),
  ('mcmaster-carr','McMaster-Carr',         'https://www.mcmaster.com',     FALSE, TRUE)
ON CONFLICT (slug) DO NOTHING;
