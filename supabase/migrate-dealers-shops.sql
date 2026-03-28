-- ============================================================
-- migrate-dealers-shops.sql
-- Dealer directory + internal shop work orders (PCB / Sheet Metal)
-- ============================================================

-- ─────────────────────────────────────────────
-- DEALERS
-- A curated directory of all dealer/wholesale accounts.
-- Matched to incoming Zoho POs via zoho_customer_name.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dealers (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name                text NOT NULL,                       -- "Sweetwater", "Guitar Center", etc.
  brand               text NOT NULL DEFAULT 'Jackson Audio', -- "Jackson Audio" | "Fulltone USA" | "Both"
  zoho_customer_name  text,                               -- matches Zoho's customer_name for auto-link
  account_number      text,
  contact_name        text,
  email               text,
  phone               text,
  billing_address     jsonb,   -- { attention, street, city, state, zip, country }
  shipping_address    jsonb,   -- primary ship-to address
  preferred_carrier   text,    -- "UPS", "FedEx", "USPS", "DHL", "Freight"
  shipping_notes      text,    -- "Requires appointment delivery", "Must use FedEx Ground", etc.
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE dealers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read dealers"
  ON dealers FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated insert dealers"
  ON dealers FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated update dealers"
  ON dealers FOR UPDATE TO authenticated USING (true);

-- Admin-only delete (uses is_admin_user() function, matches existing pattern)
CREATE POLICY "admin delete dealers"
  ON dealers FOR DELETE TO authenticated
  USING (is_admin_user());

-- ─────────────────────────────────────────────
-- SHOP ORDERS
-- Internal work orders for PCB and Sheet Metal shops.
-- Each order represents a sub-assembly run before final build.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shop_orders (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_type     text NOT NULL CHECK (shop_type IN ('pcb', 'sheet_metal')),
  order_number  text,                         -- auto-gen or manual, e.g. "PCB-2026-001"
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name  text NOT NULL,
  quantity      integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','completed','cancelled')),
  priority      text NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  due_date      date,
  for_order     text,   -- dealer PO number this feeds into (optional)
  notes         text,
  assigned_to   text,   -- team member name or id
  completed_at  timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read shop_orders"
  ON shop_orders FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated insert shop_orders"
  ON shop_orders FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated update shop_orders"
  ON shop_orders FOR UPDATE TO authenticated USING (true);

CREATE POLICY "admin delete shop_orders"
  ON shop_orders FOR DELETE TO authenticated
  USING (is_admin_user());

-- Auto-generate order numbers via sequence
CREATE SEQUENCE IF NOT EXISTS pcb_order_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sheet_metal_order_seq START 1;
