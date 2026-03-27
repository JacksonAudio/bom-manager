-- Migration: Add serial number configuration to products
-- serial_prefix: short code used in serial numbers (e.g., "BLOOM", "OCD")
-- serial_start: starting number for serial sequence (default 1)

alter table products add column if not exists serial_prefix text;
alter table products add column if not exists serial_start integer not null default 1;

-- Add email opt-in tracking to product registrations
alter table product_registrations add column if not exists email_opt_in boolean not null default false;
