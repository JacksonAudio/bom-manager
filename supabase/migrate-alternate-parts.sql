-- Migration: Add alternate_of column to parts table
-- Allows a part to be designated as a fallback/substitute for another part
-- When alternate_of is set, this part is the secondary for the referenced primary part

alter table parts add column if not exists alternate_of uuid references parts(id) on delete set null;
