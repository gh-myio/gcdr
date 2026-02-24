-- Add code column to devices table
-- This aligns devices with customers, assets, and groups which already have a code field
ALTER TABLE devices ADD COLUMN IF NOT EXISTS code VARCHAR(50);
