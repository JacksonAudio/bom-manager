-- ============================================================
-- Migration: Product Registrations — customer warranty registration
-- Customers scan QR on pedal bottom → fill out form → saved here
-- Run this in Supabase SQL Editor.
-- ============================================================

create table if not exists product_registrations (
  id               uuid primary key default gen_random_uuid(),
  serial_number    text not null,
  product_name     text not null default '',
  brand            text not null default 'Jackson Audio',

  -- Customer info
  customer_name    text not null default '',
  customer_email   text not null default '',
  customer_phone   text not null default '',
  customer_address text not null default '',
  customer_city    text not null default '',
  customer_state   text not null default '',
  customer_zip     text not null default '',
  customer_country text not null default 'US',

  -- Purchase info
  purchase_date    text not null default '',
  purchased_from   text not null default '',   -- store name or "direct"
  dealer_name      text not null default '',

  notes            text not null default '',
  registered_at    timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Klaviyo API key for auto-sync
-- ─────────────────────────────────────────────
insert into api_keys (key_name, key_value) values
  ('klaviyo_api_key', ''),
  ('klaviyo_api_key_fulltone', '')
on conflict (key_name) do nothing;

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index if not exists product_registrations_serial_idx  on product_registrations(serial_number);
create index if not exists product_registrations_email_idx   on product_registrations(customer_email);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Public insert (no auth required — customer fills out form)
-- Read/delete restricted to authenticated users
-- ─────────────────────────────────────────────
alter table product_registrations enable row level security;

-- Anyone can insert (registration form is public)
create policy "product_registrations: public insert"
  on product_registrations for insert
  to anon, authenticated
  with check (true);

-- Only authenticated users can read
create policy "product_registrations: auth users read"
  on product_registrations for select to authenticated using (true);

-- Only admins can delete
create policy "product_registrations: admin delete only"
  on product_registrations for delete to authenticated
  using (is_admin_user());

-- ─────────────────────────────────────────────
-- REALTIME
-- ─────────────────────────────────────────────
-- alter publication supabase_realtime add table product_registrations;
