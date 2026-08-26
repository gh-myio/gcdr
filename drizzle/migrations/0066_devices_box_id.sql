-- Migration 0066: RFC-0058 — BOX device profile membership (box_id)
--
-- Adds a nullable self-referential FK so a member device points at its
-- enclosure (a device with deviceProfile='BOX'). ON DELETE SET NULL detaches
-- members when a BOX is deleted (never deletes them). The BOX marker itself is
-- deviceProfile='BOX' (a free varchar) — no enum/migration needed for it.
--
-- Profile/tenant/self-reference invariants cannot be SQL CHECKs (a CHECK can't
-- read the referenced row's profile) and are enforced in DeviceService.

ALTER TABLE devices ADD COLUMN box_id uuid REFERENCES devices(id) ON DELETE SET NULL;
CREATE INDEX devices_box_id_idx ON devices (tenant_id, box_id);
