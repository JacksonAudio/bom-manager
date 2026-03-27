-- ============================================================
-- Migration: Pedal Units — individual serialized unit tracking
-- Tracks each pedal through: built → play_test → boxing → shipped
-- Run this in Supabase SQL Editor after migrate-boxing.sql.
-- ============================================================

-- ─────────────────────────────────────────────
-- PEDAL UNITS — one row per individual serialized pedal
-- ─────────────────────────────────────────────
create table if not exists pedal_units (
  id               uuid primary key default gen_random_uuid(),
  serial_number    text not null default '',
  product_id       uuid references products(id) on delete set null,
  build_order_id   uuid references build_orders(id) on delete set null,

  -- Pipeline status: built → awaiting_playtest → in_playtest → playtest_passed → playtest_failed → boxing → boxed → shipped
  status           text not null default 'built',

  -- Builder (who built this unit)
  built_by         uuid references team_members(id) on delete set null,
  built_at         timestamptz default now(),

  -- Play testing
  play_tester_id   uuid references play_testers(id) on delete set null,
  play_test_id     uuid references play_tests(id) on delete set null,
  playtest_rating  integer,
  playtest_passed  boolean,
  playtest_feedback text not null default '',
  playtest_completed_at timestamptz,

  -- Boxing
  boxing_task_id   uuid references boxing_tasks(id) on delete set null,
  boxed_by         uuid references team_members(id) on delete set null,
  boxed_at         timestamptz,

  -- Shipping / customer assignment
  customer_name    text not null default '',   -- end user or dealer name
  customer_order   text not null default '',   -- PO number or order reference
  dealer_name      text not null default '',   -- dealer/retailer if applicable
  shipped_at       timestamptz,
  tracking_number  text not null default '',

  notes            text not null default '',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Add Brady Smith notification settings to api_keys
-- ─────────────────────────────────────────────
insert into api_keys (key_name, key_value) values
  ('playtest_fail_email', 'brad@jacksonaudio.net'),
  ('playtest_fail_phone', '')
on conflict (key_name) do nothing;

-- ─────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────
drop trigger if exists pedal_units_updated_at on pedal_units;
create trigger pedal_units_updated_at
  before update on pedal_units
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index if not exists pedal_units_product_id_idx      on pedal_units(product_id);
create index if not exists pedal_units_build_order_id_idx  on pedal_units(build_order_id);
create index if not exists pedal_units_status_idx          on pedal_units(status);
create index if not exists pedal_units_serial_number_idx   on pedal_units(serial_number);
create index if not exists pedal_units_play_tester_id_idx  on pedal_units(play_tester_id);
create index if not exists pedal_units_customer_name_idx   on pedal_units(customer_name);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table pedal_units enable row level security;

create policy "pedal_units: auth users read"
  on pedal_units for select to authenticated using (true);
create policy "pedal_units: auth users insert"
  on pedal_units for insert to authenticated with check (true);
create policy "pedal_units: auth users update"
  on pedal_units for update to authenticated using (true) with check (true);
create policy "pedal_units: admin delete only"
  on pedal_units for delete to authenticated
  using (is_admin_user());

-- ─────────────────────────────────────────────
-- REALTIME
-- Run in Dashboard → Database → Replication, or uncomment:
-- ─────────────────────────────────────────────
-- alter publication supabase_realtime add table pedal_units;
