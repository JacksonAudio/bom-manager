-- ============================================================
-- Migration: Fulfillment / Shipping / Receiving system
-- Tracks the full journey from order → packing → shipping → delivery → receiving
-- Run this in Supabase SQL Editor after migrate-pedal-units.sql.
-- ============================================================

-- ─────────────────────────────────────────────
-- SHIPPING BOXES CONFIG — box sizes the company stocks
-- ─────────────────────────────────────────────
create table if not exists shipping_boxes_config (
  id               uuid primary key default gen_random_uuid(),
  name             text not null default '',          -- e.g. "Small", "Medium", "Large"
  length_in        numeric not null default 0,        -- inner length in inches
  width_in         numeric not null default 0,        -- inner width in inches
  height_in        numeric not null default 0,        -- inner height in inches
  max_weight_lbs   numeric not null default 0,        -- weight limit
  cost             numeric not null default 0,        -- cost per box
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- PRODUCT PACKAGING — dimensions/weight of each product's retail box
-- ─────────────────────────────────────────────
create table if not exists product_packaging (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id) on delete cascade,
  length_in        numeric not null default 0,        -- product box length in inches
  width_in         numeric not null default 0,        -- product box width in inches
  height_in        numeric not null default 0,        -- product box height in inches
  weight_lbs       numeric not null default 0,        -- weight with product inside
  can_stack        boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint product_packaging_product_id_unique unique (product_id)
);

-- ─────────────────────────────────────────────
-- FULFILLMENTS — links an order to its shipping journey
-- ─────────────────────────────────────────────
create table if not exists fulfillments (
  id               uuid primary key default gen_random_uuid(),
  order_source     text not null default 'manual',    -- 'shopify', 'zoho', 'manual'
  order_ref        text not null default '',           -- PO number or order number
  order_id         text not null default '',           -- external order ID
  customer_name    text not null default '',
  dealer_name      text not null default '',
  ship_to_address  jsonb,                              -- full address object
  status           text not null default 'pending',    -- pending|packing|shipped|delivered|received
  notes            text not null default '',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  shipped_at       timestamptz,
  delivered_at     timestamptz,
  received_at      timestamptz
);

-- ─────────────────────────────────────────────
-- SHIPMENT BOXES — physical boxes in a fulfillment
-- ─────────────────────────────────────────────
create table if not exists shipment_boxes (
  id               uuid primary key default gen_random_uuid(),
  fulfillment_id   uuid not null references fulfillments(id) on delete cascade,
  box_config_id    uuid references shipping_boxes_config(id) on delete set null,
  box_number       integer not null default 1,         -- 1, 2, 3...
  total_boxes      integer not null default 1,         -- total in this fulfillment
  tracking_number  text not null default '',
  carrier          text not null default '',            -- 'FedEx', 'UPS', 'USPS', etc.
  weight_lbs       numeric not null default 0,         -- actual weight
  qr_token         text unique,                        -- random token for public packing list URL
  status           text not null default 'packing',    -- packing|sealed|shipped|delivered|received
  packed_by        uuid references team_members(id) on delete set null,
  packed_at        timestamptz,
  shipped_at       timestamptz,
  received_at      timestamptz,
  received_by_name text not null default '',            -- who at the distributor received it
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- BOX ITEMS — which pedal units go in which box
-- ─────────────────────────────────────────────
create table if not exists box_items (
  id               uuid primary key default gen_random_uuid(),
  box_id           uuid not null references shipment_boxes(id) on delete cascade,
  pedal_unit_id    uuid not null references pedal_units(id) on delete cascade,
  received         boolean not null default false,     -- distributor checked this off
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint box_items_pedal_unit_id_unique unique (pedal_unit_id)
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────

-- shipping_boxes_config
create index if not exists shipping_boxes_config_active_idx on shipping_boxes_config(active);

-- product_packaging
create index if not exists product_packaging_product_id_idx on product_packaging(product_id);

-- fulfillments
create index if not exists fulfillments_status_idx          on fulfillments(status);
create index if not exists fulfillments_order_source_idx    on fulfillments(order_source);
create index if not exists fulfillments_order_ref_idx       on fulfillments(order_ref);
create index if not exists fulfillments_created_by_idx      on fulfillments(created_by);

-- shipment_boxes
create index if not exists shipment_boxes_fulfillment_id_idx on shipment_boxes(fulfillment_id);
create index if not exists shipment_boxes_box_config_id_idx  on shipment_boxes(box_config_id);
create index if not exists shipment_boxes_qr_token_idx       on shipment_boxes(qr_token);
create index if not exists shipment_boxes_status_idx         on shipment_boxes(status);
create index if not exists shipment_boxes_packed_by_idx      on shipment_boxes(packed_by);
create index if not exists shipment_boxes_tracking_number_idx on shipment_boxes(tracking_number);

-- box_items
create index if not exists box_items_box_id_idx         on box_items(box_id);
create index if not exists box_items_pedal_unit_id_idx  on box_items(pedal_unit_id);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

-- shipping_boxes_config
alter table shipping_boxes_config enable row level security;

create policy "shipping_boxes_config: auth users read"
  on shipping_boxes_config for select to authenticated using (true);
create policy "shipping_boxes_config: auth users insert"
  on shipping_boxes_config for insert to authenticated with check (true);
create policy "shipping_boxes_config: auth users update"
  on shipping_boxes_config for update to authenticated using (true) with check (true);
create policy "shipping_boxes_config: admin delete only"
  on shipping_boxes_config for delete to authenticated
  using (is_admin_user());

-- product_packaging
alter table product_packaging enable row level security;

create policy "product_packaging: auth users read"
  on product_packaging for select to authenticated using (true);
create policy "product_packaging: auth users insert"
  on product_packaging for insert to authenticated with check (true);
create policy "product_packaging: auth users update"
  on product_packaging for update to authenticated using (true) with check (true);
create policy "product_packaging: admin delete only"
  on product_packaging for delete to authenticated
  using (is_admin_user());

-- fulfillments
alter table fulfillments enable row level security;

create policy "fulfillments: auth users read"
  on fulfillments for select to authenticated using (true);
create policy "fulfillments: auth users insert"
  on fulfillments for insert to authenticated with check (true);
create policy "fulfillments: auth users update"
  on fulfillments for update to authenticated using (true) with check (true);
create policy "fulfillments: admin delete only"
  on fulfillments for delete to authenticated
  using (is_admin_user());

-- shipment_boxes
alter table shipment_boxes enable row level security;

create policy "shipment_boxes: auth users read"
  on shipment_boxes for select to authenticated using (true);
create policy "shipment_boxes: auth users insert"
  on shipment_boxes for insert to authenticated with check (true);
create policy "shipment_boxes: auth users update"
  on shipment_boxes for update to authenticated using (true) with check (true);
create policy "shipment_boxes: admin delete only"
  on shipment_boxes for delete to authenticated
  using (is_admin_user());

-- box_items
alter table box_items enable row level security;

create policy "box_items: auth users read"
  on box_items for select to authenticated using (true);
create policy "box_items: auth users insert"
  on box_items for insert to authenticated with check (true);
create policy "box_items: auth users update"
  on box_items for update to authenticated using (true) with check (true);
create policy "box_items: admin delete only"
  on box_items for delete to authenticated
  using (is_admin_user());

-- ─────────────────────────────────────────────
-- REALTIME
-- Run in Dashboard -> Database -> Replication, or uncomment:
-- ─────────────────────────────────────────────
-- alter publication supabase_realtime add table shipping_boxes_config;
-- alter publication supabase_realtime add table product_packaging;
-- alter publication supabase_realtime add table fulfillments;
-- alter publication supabase_realtime add table shipment_boxes;
-- alter publication supabase_realtime add table box_items;
