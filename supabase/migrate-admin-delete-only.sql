-- ============================================================
-- Migration: Admin-only DELETE permissions
-- Run this in Supabase SQL Editor to enforce at the DB level
-- that only admin emails can delete records.
-- ============================================================

-- Helper function: check if the current JWT email is in the admin_emails list
create or replace function is_admin_user()
returns boolean as $$
  select exists(
    select 1 from api_keys
    where key_name = 'admin_emails'
      and key_value ilike '%' || (auth.jwt()->>'email') || '%'
  );
$$ language sql security definer stable;

-- ── PARTS: split full access into read/write + admin-only delete
drop policy if exists "parts: auth users full access" on parts;
drop policy if exists "parts: auth users read/write" on parts;
drop policy if exists "parts: admin delete only" on parts;

create policy "parts: auth users read/write"
  on parts for select using (true);

create policy "parts: auth users insert"
  on parts for insert to authenticated
  with check (true);

create policy "parts: auth users update"
  on parts for update to authenticated
  using (true) with check (true);

create policy "parts: admin delete only"
  on parts for delete to authenticated
  using (is_admin_user());

-- ── PRODUCTS: same pattern
drop policy if exists "products: auth users full access" on products;
drop policy if exists "products: auth users read/write" on products;
drop policy if exists "products: admin delete only" on products;

create policy "products: auth users read/write"
  on products for select using (true);

create policy "products: auth users insert"
  on products for insert to authenticated
  with check (true);

create policy "products: auth users update"
  on products for update to authenticated
  using (true) with check (true);

create policy "products: admin delete only"
  on products for delete to authenticated
  using (is_admin_user());

-- ── TEAM_MEMBERS: same pattern
drop policy if exists "team_members: auth users full access" on team_members;
drop policy if exists "team_members: auth users read/write" on team_members;
drop policy if exists "team_members: admin delete only" on team_members;

create policy "team_members: auth users read/write"
  on team_members for select using (true);

create policy "team_members: auth users insert"
  on team_members for insert to authenticated
  with check (true);

create policy "team_members: auth users update"
  on team_members for update to authenticated
  using (true) with check (true);

create policy "team_members: admin delete only"
  on team_members for delete to authenticated
  using (is_admin_user());

-- ── BUILD_ORDERS: same pattern
drop policy if exists "build_orders: auth users full access" on build_orders;
drop policy if exists "build_orders: auth users read/write" on build_orders;
drop policy if exists "build_orders: admin delete only" on build_orders;

create policy "build_orders: auth users read/write"
  on build_orders for select using (true);

create policy "build_orders: auth users insert"
  on build_orders for insert to authenticated
  with check (true);

create policy "build_orders: auth users update"
  on build_orders for update to authenticated
  using (true) with check (true);

create policy "build_orders: admin delete only"
  on build_orders for delete to authenticated
  using (is_admin_user());
