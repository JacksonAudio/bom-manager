-- ============================================================
-- Migration: Play Testing — assign and track play test sessions
-- Run this in Supabase SQL Editor after the main schema.
-- Dashboard → SQL Editor → New query → Paste → Run
-- ============================================================

-- ─────────────────────────────────────────────
-- PLAY TESTERS — people who test finished builds
-- ─────────────────────────────────────────────
create table if not exists play_testers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null default '',
  phone       text not null default '',
  address     text not null default '',
  notes       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- PLAY TESTS — individual test sessions
-- Links a product (and optionally a build order) to a tester
-- ─────────────────────────────────────────────
create table if not exists play_tests (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid references products(id) on delete set null,
  build_order_id   uuid references build_orders(id) on delete set null,
  play_tester_id   uuid references play_testers(id) on delete set null,
  serial_number    text not null default '',
  status           text not null default 'assigned',  -- assigned|shipped|in_testing|feedback_received|returned
  shipped_at       timestamptz,
  tracking_number  text not null default '',
  due_date         timestamptz,
  returned_at      timestamptz,
  rating           integer,         -- 1-5 star rating
  passed           boolean,         -- pass/fail result
  feedback         text not null default '',
  notes            text not null default '',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- TRIGGERS — auto-update updated_at
-- ─────────────────────────────────────────────
drop trigger if exists play_testers_updated_at on play_testers;
create trigger play_testers_updated_at
  before update on play_testers
  for each row execute function set_updated_at();

drop trigger if exists play_tests_updated_at on play_tests;
create trigger play_tests_updated_at
  before update on play_tests
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index if not exists play_tests_product_id_idx     on play_tests(product_id);
create index if not exists play_tests_play_tester_id_idx on play_tests(play_tester_id);
create index if not exists play_tests_status_idx         on play_tests(status);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table play_testers enable row level security;
alter table play_tests   enable row level security;

-- Read/write for authenticated users
create policy "play_testers: auth users read"
  on play_testers for select to authenticated using (true);
create policy "play_testers: auth users insert"
  on play_testers for insert to authenticated with check (true);
create policy "play_testers: auth users update"
  on play_testers for update to authenticated using (true) with check (true);

create policy "play_tests: auth users read"
  on play_tests for select to authenticated using (true);
create policy "play_tests: auth users insert"
  on play_tests for insert to authenticated with check (true);
create policy "play_tests: auth users update"
  on play_tests for update to authenticated using (true) with check (true);

-- Admin-only delete (consistent with other tables)
create policy "play_testers: admin delete only"
  on play_testers for delete to authenticated
  using (is_admin_user());
create policy "play_tests: admin delete only"
  on play_tests for delete to authenticated
  using (is_admin_user());

-- ─────────────────────────────────────────────
-- REALTIME — enable live updates
-- Run in Dashboard → Database → Replication, or uncomment:
-- ─────────────────────────────────────────────
-- alter publication supabase_realtime add table play_testers;
-- alter publication supabase_realtime add table play_tests;
