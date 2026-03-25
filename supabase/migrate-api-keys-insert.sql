-- Migration: Allow authenticated users to INSERT api_keys rows + seed missing keys
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Paste → Run

-- 1. Add INSERT policy (safe to run if it already exists)
DO $$ BEGIN
  CREATE POLICY "api_keys: auth users insert"
    ON api_keys FOR INSERT
    TO authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Seed all expected key rows (skips any that already exist)
INSERT INTO api_keys (key_name, key_value) VALUES
  ('nexar_client_id',       ''),
  ('nexar_client_secret',   ''),
  ('mouser_api_key',        ''),
  ('mouser_order_api_key',  ''),
  ('digikey_client_id',     ''),
  ('digikey_client_secret', ''),
  ('arrow_api_key',         ''),
  ('arrow_login',           ''),
  ('ti_api_key',            ''),
  ('ti_api_secret',         ''),
  ('notify_email',          ''),
  ('supplier_emails',       ''),
  ('tariffs_json',          ''),
  ('shipping_json',         ''),
  ('shopify_stores_json',   ''),
  ('company_name',          'Jackson Audio'),
  ('company_address',       ''),
  ('distributor_names',     ''),
  ('supplier_contacts',     ''),
  ('supplier_po_names',     ''),
  ('supplier_order_modes',  ''),
  ('anthropic_api_key',     ''),
  ('twilio_account_sid',    ''),
  ('twilio_auth_token',     ''),
  ('twilio_phone_number',   ''),
  ('labor_rate_hourly',     '25'),
  ('preferred_supplier',    'mouser'),
  ('preferred_supplier_margin', '5'),
  ('zoho_client_id',        ''),
  ('zoho_client_secret',    ''),
  ('zoho_refresh_token',    ''),
  ('zoho_org_id',           ''),
  ('zoho_orgs_json',        ''),
  ('shipstation_api_key',   ''),
  ('shipstation_api_secret',''),
  ('fulfillment_goal_direct','1'),
  ('fulfillment_goal_dealer','14'),
  ('timezone',              'America/Chicago'),
  ('build_goals_json',      '')
ON CONFLICT (key_name) DO NOTHING;
