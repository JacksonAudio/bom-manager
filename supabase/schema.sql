-- ============================================================
-- JACKSON AUDIO — BOM Manager Database Schema
-- Thursday, March 12, 2026
--
-- Run this entire file in your Supabase SQL Editor once.
-- Dashboard → SQL Editor → New query → Paste → Run
-- ============================================================

-- ─────────────────────────────────────────────
-- PRODUCTS
-- One row per physical product (pedal, rack unit, etc.)
-- ─────────────────────────────────────────────
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#f59e0b',  -- hex color for UI card accent
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- PARTS
-- One row per part-in-product (same MPN used in two products = two rows)
-- ─────────────────────────────────────────────
create table if not exists parts (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid references products(id) on delete set null,
  mpn                text not null default '',      -- manufacturer part number (required for pricing)
  reference          text not null default '',      -- designator(s), e.g. "R1, R2"
  value              text not null default '',      -- e.g. "10k", "100nF"
  description        text not null default '',
  footprint          text not null default '',
  manufacturer       text not null default '',
  quantity           integer not null default 1,
  unit_cost          numeric(12,6),                 -- null = unpriced
  stock_qty          integer,
  reorder_qty        integer,
  preferred_supplier text not null default 'mouser',
  order_qty          integer,
  flagged_for_order  boolean not null default false,
  -- Pricing cache: last fetched prices as JSONB so we don't re-fetch every load
  pricing            jsonb,
  pricing_status     text not null default 'idle',  -- idle|loading|done|error|no-mpn
  pricing_error      text not null default '',
  best_supplier      text,
  -- Attribution
  created_by         uuid references auth.users(id) on delete set null,
  updated_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- API KEYS (shared team-wide, one row per key name)
-- Stored in DB so the whole team shares one set.
-- NOTE: Supabase encrypts data at rest; these are not end-to-end encrypted.
-- For production, consider Supabase Vault for secrets.
-- ─────────────────────────────────────────────
create table if not exists api_keys (
  key_name    text primary key,                     -- e.g. 'nexar_client_id'
  key_value   text not null default '',
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Seed default key name rows so upserts work cleanly
insert into api_keys (key_name, key_value) values
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
on conflict (key_name) do nothing;

-- ─────────────────────────────────────────────
-- UPDATED_AT trigger function (reusable)
-- ─────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Attach trigger to products
drop trigger if exists products_updated_at on products;
create trigger products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- Attach trigger to parts
drop trigger if exists parts_updated_at on parts;
create trigger parts_updated_at
  before update on parts
  for each row execute function set_updated_at();

-- Attach trigger to api_keys
drop trigger if exists api_keys_updated_at on api_keys;
create trigger api_keys_updated_at
  before update on api_keys
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- INDEXES — speed up common queries
-- ─────────────────────────────────────────────
create index if not exists parts_product_id_idx  on parts(product_id);
create index if not exists parts_mpn_idx         on parts(mpn);
create index if not exists parts_flagged_idx     on parts(flagged_for_order) where flagged_for_order = true;
create index if not exists parts_created_by_idx  on parts(created_by);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- All authenticated users share one workspace.
-- Anon users see nothing.
-- ─────────────────────────────────────────────

-- Enable RLS on all tables
alter table products  enable row level security;
alter table parts     enable row level security;
alter table api_keys  enable row level security;

-- PRODUCTS: any logged-in user can read/write/delete
create policy "products: auth users full access"
  on products for all
  to authenticated
  using (true)
  with check (true);

-- PARTS: any logged-in user can read/write/delete
create policy "parts: auth users full access"
  on parts for all
  to authenticated
  using (true)
  with check (true);

-- API_KEYS: any logged-in user can read, insert, and update
create policy "api_keys: auth users read"
  on api_keys for select
  to authenticated
  using (true);

create policy "api_keys: auth users insert"
  on api_keys for insert
  to authenticated
  with check (true);

create policy "api_keys: auth users update"
  on api_keys for update
  to authenticated
  using (true)
  with check (true);

-- ─────────────────────────────────────────────
-- REALTIME — enable live updates for all tables
-- This lets every browser tab see changes instantly.
-- Run these in the Supabase dashboard after the schema:
--   Dashboard → Database → Replication → toggle on: products, parts, api_keys
-- Or uncomment and run the lines below:
-- ─────────────────────────────────────────────
-- alter publication supabase_realtime add table products;
-- alter publication supabase_realtime add table parts;
-- alter publication supabase_realtime add table api_keys;
