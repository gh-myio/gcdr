-- Migration: add LOCATION to asset_type enum
-- Date: 2026-03-18

ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'LOCATION';
