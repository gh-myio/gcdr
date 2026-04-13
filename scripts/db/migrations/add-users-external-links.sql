-- Migration: add external_links to users
-- Purpose: support multi-system integration tracking (ThingsBoard, Freshdesk, App, OS, etc.)
-- Each entry: { system, externalId, status, syncedAt, createdAt, updatedAt, version }

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS external_links jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN users.external_links IS
  'Array of external system links. Each entry: { system: string, externalId: string, status: synced|pending|error|disconnected, syncedAt?: ISO, createdAt: ISO, updatedAt: ISO, version?: int }';
