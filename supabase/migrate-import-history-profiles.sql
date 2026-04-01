-- ============================================================
-- Migration: Import History + User Profiles
-- Run in Supabase SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────
-- USER PROFILES
-- One row per team member with contact info.
-- Separate from auth.users — stores display names,
-- phone numbers, etc. for the employee directory.
-- ─────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text not null default '',
  phone       text not null default '',
  role        text not null default 'employee',   -- 'admin' | 'editor' | 'employee'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS
alter table profiles enable row level security;
create policy "Profiles are visible to authenticated users"
  on profiles for select using (auth.role() = 'authenticated');
create policy "Users can update their own profile"
  on profiles for update using (auth.uid() = id);
create policy "Admins can insert/update any profile"
  on profiles for all using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- PART IMPORTS
-- One row per import batch (CSV or invoice).
-- part_ids stores the UUIDs of all parts created.
-- ─────────────────────────────────────────────
create table if not exists part_imports (
  id           uuid primary key default gen_random_uuid(),
  imported_by  uuid references auth.users(id) on delete set null,
  imported_at  timestamptz not null default now(),
  filename     text not null default '',
  import_type  text not null default 'csv-import',  -- 'csv-import' | 'invoice-import'
  part_ids     uuid[] not null default '{}',
  part_count   integer not null default 0
);

-- RLS
alter table part_imports enable row level security;
create policy "Import history visible to authenticated users"
  on part_imports for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert import records"
  on part_imports for insert with check (auth.role() = 'authenticated');
create policy "Authenticated users can delete import batches"
  on part_imports for delete using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- SOFT-DELETE for parts
-- Add deleted_at column to parts so BOM can show
-- a red placeholder row when a part is removed.
-- ─────────────────────────────────────────────
alter table parts add column if not exists deleted_at timestamptz default null;
alter table parts add column if not exists deleted_by uuid references auth.users(id) on delete set null default null;
