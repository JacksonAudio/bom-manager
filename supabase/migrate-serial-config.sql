-- Migration: Add serial number configuration to products
-- serial_prefix: short code used in serial numbers (e.g., "BLOOM", "OCD")
-- serial_start: starting number for serial sequence (default 1)

alter table products add column if not exists serial_prefix text;
alter table products add column if not exists serial_start integer not null default 1;
alter table products add column if not exists upc text;  -- UPC/EAN barcode for retail scanning
alter table products add column if not exists import_name text;  -- Original imported name, frozen for order matching

-- Backfill import_name for existing products that don't have one
update products set import_name = name where import_name is null;

-- Add email opt-in tracking to product registrations
alter table product_registrations add column if not exists email_opt_in boolean not null default false;
