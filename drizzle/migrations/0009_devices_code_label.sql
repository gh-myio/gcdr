-- Add code and label columns to devices table
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "code" varchar(50);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "label" varchar(100);
