-- ============================================================
-- JACKSON AUDIO — Inventory Ledger, Component Reservations,
-- Finished Goods Shelf, and Unit Repairs
-- 2026-03-28
--
-- Run in Supabase Dashboard → SQL Editor → New query → Paste → Run
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. INVENTORY TRANSACTIONS (permanent ledger)
-- Every component stock movement ever. Never deleted.
-- positive quantity_delta = stock added
-- negative quantity_delta = stock removed
-- ─────────────────────────────────────────────
create table if not exists inventory_transactions (
  id               uuid primary key default gen_random_uuid(),
  part_id          uuid references parts(id) on delete set null,
  type             text not null,
  -- Types: 'received'            — parts arrived from supplier PO
  --        'used_in_build'       — parts consumed by a completed build
  --        'reserved'            — parts locked to a build order
  --        'reservation_released'— reservation cancelled, parts returned to available
  --        'adjustment'          — manual stock correction
  --        'scrap'               — parts discarded (damage, defect, etc.)
  --        'returned'            — parts returned from a failed/cancelled build
  quantity_delta   integer not null,          -- positive = in, negative = out
  quantity_before  integer,                   -- stock level before this transaction
  quantity_after   integer,                   -- stock level after this transaction
  reference_type   text,                      -- 'purchase_order' | 'build_order' | 'reservation' | 'manual' | 'scrap'
  reference_id     uuid,                      -- FK to relevant record (nullable — no hard constraint, flexible)
  notes            text not null default '',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists inv_tx_part_id_idx      on inventory_transactions(part_id);
create index if not exists inv_tx_type_idx         on inventory_transactions(type);
create index if not exists inv_tx_reference_id_idx on inventory_transactions(reference_id);
create index if not exists inv_tx_created_at_idx   on inventory_transactions(created_at desc);

alter table inventory_transactions enable row level security;

create policy "inventory_transactions: auth users full access"
  on inventory_transactions for all
  to authenticated
  using (true)
  with check (true);

alter publication supabase_realtime add table inventory_transactions;


-- ─────────────────────────────────────────────
-- 2. COMPONENT RESERVATIONS
-- Parts locked to a specific build order.
-- When a build order is created, one row per part per build order.
-- Status:
--   'active'   — parts are reserved, unavailable to other builds
--   'consumed' — build completed, parts were used
--   'released' — reservation cancelled, parts returned to available pool
-- ─────────────────────────────────────────────
create table if not exists component_reservations (
  id               uuid primary key default gen_random_uuid(),
  build_order_id   uuid references build_orders(id) on delete cascade,
  part_id          uuid references parts(id) on delete cascade,
  reserved_qty     integer not null,
  consumed_qty     integer not null default 0,
  status           text not null default 'active',  -- active | consumed | released
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  released_at      timestamptz,
  released_by      uuid references auth.users(id) on delete set null,
  unique (build_order_id, part_id)   -- one reservation row per part per build
);

create index if not exists comp_res_build_order_idx on component_reservations(build_order_id);
create index if not exists comp_res_part_id_idx     on component_reservations(part_id);
create index if not exists comp_res_status_idx      on component_reservations(status);

alter table component_reservations enable row level security;

create policy "component_reservations: auth users full access"
  on component_reservations for all
  to authenticated
  using (true)
  with check (true);

alter publication supabase_realtime add table component_reservations;


-- ─────────────────────────────────────────────
-- 3. FINISHED GOODS (shelf inventory)
-- One row per product. Updated whenever units are
-- scanned onto the shelf or pulled for an order.
-- ─────────────────────────────────────────────
create table if not exists finished_goods (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid references products(id) on delete cascade unique,
  quantity_on_hand integer not null default 0,
  target_stock     integer not null default 0,   -- ideal shelf level
  min_stock        integer not null default 0,   -- alert threshold
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);

create index if not exists finished_goods_product_idx on finished_goods(product_id);

alter table finished_goods enable row level security;

create policy "finished_goods: auth users full access"
  on finished_goods for all
  to authenticated
  using (true)
  with check (true);

alter publication supabase_realtime add table finished_goods;


-- ─────────────────────────────────────────────
-- 4. UNIT REPAIRS
-- Tracks returned/failed units through the repair process.
-- Linked to pedal_units by serial number for full history.
-- Status flow:
--   intake → diagnosing → repairing → testing → repaired → shipped_back
--   (or) → scrapped at any point
-- ─────────────────────────────────────────────
create table if not exists unit_repairs (
  id                  uuid primary key default gen_random_uuid(),
  pedal_unit_id       uuid references pedal_units(id) on delete set null,
  serial_number       text not null,             -- denormalized for fast lookup without join
  fault_description   text not null default '',  -- what the customer/tech reported
  diagnosis           text not null default '',  -- what was actually found
  repair_notes        text not null default '',  -- what was done to fix it
  status              text not null default 'intake',
  -- intake | diagnosing | repairing | testing | repaired | scrapped | shipped_back
  shipstation_label_id text,                     -- ShipStation label ID when shipped back
  tracking_number     text,
  intake_at           timestamptz not null default now(),
  repaired_at         timestamptz,
  shipped_at          timestamptz,
  repaired_by         uuid references auth.users(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists unit_repairs_serial_idx       on unit_repairs(serial_number);
create index if not exists unit_repairs_pedal_unit_idx   on unit_repairs(pedal_unit_id);
create index if not exists unit_repairs_status_idx       on unit_repairs(status);

drop trigger if exists unit_repairs_updated_at on unit_repairs;
create trigger unit_repairs_updated_at
  before update on unit_repairs
  for each row execute function set_updated_at();

alter table unit_repairs enable row level security;

create policy "unit_repairs: auth users full access"
  on unit_repairs for all
  to authenticated
  using (true)
  with check (true);

alter publication supabase_realtime add table unit_repairs;
