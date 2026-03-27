-- ============================================================
-- Migration: Boxing Tasks — track boxing/packaging of finished units
-- Boxing can only begin after a pedal is built and play tested.
-- Run this in Supabase SQL Editor after migrate-play-testing.sql.
-- ============================================================

-- ─────────────────────────────────────────────
-- BOXING TASKS
-- One row per boxing assignment — links a build order to a team
-- member responsible for packaging finished, play-tested units.
-- ─────────────────────────────────────────────
create table if not exists boxing_tasks (
  id               uuid primary key default gen_random_uuid(),
  build_order_id   uuid references build_orders(id) on delete set null,
  product_id       uuid references products(id) on delete set null,
  team_member_id   uuid references team_members(id) on delete set null,
  quantity         integer not null default 1,       -- units to box
  completed_count  integer not null default 0,       -- units boxed so far
  status           text not null default 'pending',  -- pending|in_progress|completed
  for_order        text not null default '',          -- customer PO / order reference
  priority         text not null default 'normal',    -- low|normal|high|urgent
  due_date         timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  notes            text not null default '',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────
drop trigger if exists boxing_tasks_updated_at on boxing_tasks;
create trigger boxing_tasks_updated_at
  before update on boxing_tasks
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index if not exists boxing_tasks_build_order_id_idx  on boxing_tasks(build_order_id);
create index if not exists boxing_tasks_team_member_id_idx  on boxing_tasks(team_member_id);
create index if not exists boxing_tasks_status_idx          on boxing_tasks(status);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table boxing_tasks enable row level security;

create policy "boxing_tasks: auth users read"
  on boxing_tasks for select to authenticated using (true);
create policy "boxing_tasks: auth users insert"
  on boxing_tasks for insert to authenticated with check (true);
create policy "boxing_tasks: auth users update"
  on boxing_tasks for update to authenticated using (true) with check (true);
create policy "boxing_tasks: admin delete only"
  on boxing_tasks for delete to authenticated
  using (is_admin_user());

-- ─────────────────────────────────────────────
-- REALTIME
-- Run in Dashboard → Database → Replication, or uncomment:
-- ─────────────────────────────────────────────
-- alter publication supabase_realtime add table boxing_tasks;
