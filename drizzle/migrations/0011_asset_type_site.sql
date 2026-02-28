-- Add SITE to asset_type enum
-- RFC: ThingsBoard sync uses 'SITE' as top-level asset type
ALTER TYPE "public"."asset_type" ADD VALUE IF NOT EXISTS 'SITE';
