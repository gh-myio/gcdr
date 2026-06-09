-- =============================================================================
-- PROD (Dokploy) — apply via SQL only. Paste into the PostgreSQL terminal.
-- =============================================================================
-- Does two things, idempotently and safely (re-runnable):
--   1) Schema fix = migration 0030: recreate the devices channel-uniqueness
--      index WITH NULLS NOT DISTINCT and (re)add the channel range CHECK.
--      Needed because the cloud DB was built by `drizzle-kit push`, which
--      created the index WITHOUT NULLS NOT DISTINCT and without the CHECK.
--   2) Migration governance: create the `schema_migrations` control table and
--      baseline migrations 0000..0030 (records them as applied — their end
--      state is already present in this DB).
--
-- Requires PostgreSQL 15+ (NULLS NOT DISTINCT). Safe: existing rows already
-- satisfy (central, slave) uniqueness, so the index rebuild cannot fail on a
-- duplicate.
--
-- ⚠️ LOCKING: the DROP + CREATE UNIQUE INDEX below briefly locks writes on
-- `devices`. If that table is large, run this in a low-traffic window, OR use
-- the CONCURRENTLY variant (see the note at the bottom).
--
-- ⚠️ NO explicit BEGIN/COMMIT here: postgres-js (and the Dokploy SQL runner)
-- reject manual transaction control with "UNSAFE_TRANSACTION". This whole script
-- is idempotent, so it is safe to run without a wrapping transaction. For
-- atomicity with the psql CLI, run it as:  psql "<url>" --single-transaction -f thisfile.sql
-- =============================================================================

-- ── 1) Schema fix (migration 0030) ──────────────────────────────────────────
DROP INDEX IF EXISTS "devices_tenant_central_slave_channel_unique";
CREATE UNIQUE INDEX "devices_tenant_central_slave_channel_unique"
  ON "devices" ("tenant_id", "central_id", "slave_id", "channel", "device_channel_type")
  NULLS NOT DISTINCT
  WHERE "central_id" IS NOT NULL AND "slave_id" IS NOT NULL;

ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_channel_range_check";
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_channel_range_check"
  CHECK ("channel" IS NULL OR ("channel" >= 0 AND "channel" <= 999));

-- ── 2) Migration governance table + baseline ────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    text        PRIMARY KEY,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text
);

INSERT INTO schema_migrations (filename, checksum, applied_by) VALUES
  ('0000_third_tempest.sql',                       '3db8321733d2853879f9f48b9086667131d0f98ae9ace6a4c2edbda75ad6aa1a', 'prod-sql'),
  ('0001_fuzzy_mojo.sql',                          'd334462aa918aa8cdc8392431b30c273cf4870cbcf13c4571626d6d46426bd48', 'prod-sql'),
  ('0002_misty_unicorn.sql',                       '8e9d782011eaa30ddcb8e1448cbe58dc75306a70e45d8c586ae003e9175d2c61', 'prod-sql'),
  ('0003_reflective_mesmero.sql',                  'bdfb0d79f0fa45bece45bf8e96af123e7f19f0455b79c0b0d4146d63f1f83cc7', 'prod-sql'),
  ('0004_vengeful_rawhide_kid.sql',                '60fe9ffa302cd3dca810e259b8f247c4d04d8863efd888e426d0cb2de0cbf1b0', 'prod-sql'),
  ('0005_glamorous_rafael_vega.sql',               '6c02228bf90d399c73cef060da42fa039882fe7d070a8696c6c6f8b4c49d7f12', 'prod-sql'),
  ('0006_melodic_satana.sql',                      '96392403e9da9537c62b4bb54172d011487d157a701b5df187c4aa2458eb831d', 'prod-sql'),
  ('0007_graceful_firelord.sql',                   'ae685cdd5a65fd6562ed9c6bd36ddce3290f03663fdc8abde5973d340fc8a212', 'prod-sql'),
  ('0008_device_name_unique.sql',                  'b15a11df005acc414930acb407cafde687cf6f85c168e18cc245b57eccd1b5b0', 'prod-sql'),
  ('0009_devices_code_label.sql',                  '12a328df74fee879c8e31043585de655097aa468d7902cc11b06f1e8b6198cb0', 'prod-sql'),
  ('0010_rules_scope_entity_overrides.sql',        '66e17f2d3896ebcd7f8a2d27be444c2b15878764bab3d2924d8381c57a4086f2', 'prod-sql'),
  ('0011_asset_type_site.sql',                     '11e1b120fc20acdedbf7ff2b2909de6132c4c52adb173e41bfd5788181858029', 'prod-sql'),
  ('0012_customer_config.sql',                     '0b648bebd42151cac3a990e166a1448ffa855092d99b0d79dc9aad639ba5fa89', 'prod-sql'),
  ('0013_device_sync_jobs.sql',                    '0c1dc43ab5c1bbff1003f3380ce6b8f1cd20d6ebbea427b5d4fe71c536ad5710', 'prod-sql'),
  ('0014_alarm_dispatch_config.sql',               '3193bbe146fcb2160e67a3544fde12066632cabfb1a6c1f55c6f7f4a633d89af', 'prod-sql'),
  ('0015_drop_valid_scope_entity_constraint.sql',  '2f309c75464af15769f4250810f8fe19c85eb85616d0fe53bb33f0bd6c0c52d6', 'prod-sql'),
  ('0016_user_contacts.sql',                       '0c614cdc979f32c05f8bd906a097783eb27689d23ad04cf74fe6a48183ad7c58', 'prod-sql'),
  ('0017_templates_customer_id.sql',               '5f6996da016729e8811e0bb6e5988dd086ce3dbd494daec82ce2db4f138c0699', 'prod-sql'),
  ('0018_group_channels.sql',                      'a04915ad6d9907e136a8079a58ee395e966414c199927b2f65eb297e317722cb', 'prod-sql'),
  ('0019_rules_is_internal_support_rule.sql',      '79e3ca406d150947f8741bcf00ed502ee94496fbc16f2f8a7f2b339c53126040', 'prod-sql'),
  ('0020_wiki_module.sql',                         '4de2a21f02580747f56ec5d02348c4d7ff5087c4eb59f80f353307c24d4bbc86', 'prod-sql'),
  ('0021_wiki_page_links.sql',                     'e330698302f0d762d97537739f8284c1fa17d5616a31d0093371c5fd38f17921', 'prod-sql'),
  ('0022_file_assets.sql',                         '77095075a40ee11f301aeb58651579042982fceb87b3c2f18a3055f5e2ddbbc2', 'prod-sql'),
  ('0023_file_assets_public_slug.sql',             '5aa56de03a67ee699cb4f7f92fd274b1267403384630224ee50ac6d5b55a8a2c', 'prod-sql'),
  ('0024_qrchecker_schema.sql',                    'f0a83605127afe4d85f121e1636ad58ab3957df07ceed1ff3ad76c6d4e886acd', 'prod-sql'),
  ('0025_devices_metering_columns.sql',            '9e0f95592d232615dccaa34e6f77748d8aeeab88c1e9a2cb6245d5b70d3f46ee', 'prod-sql'),
  ('0026_rename_qrc_to_wo.sql',                    '65b156ab5c79e17477083d27311d859aa362918d9b927bbc4ce326f92de9c638', 'prod-sql'),
  ('0027_centrals_frequency.sql',                  'f792f6867d472852bb48a45fffec70c9f51674dfca5303f7dc730a3482e89870', 'prod-sql'),
  ('0028_centrals_frequency_channel_range.sql',    'eef3c7034306ceb6fd2cfdc7f3f748068ab2e836c03d0069622355d7eaf0c790', 'prod-sql'),
  ('0029_devices_channel.sql',                     '2ea6ef0b6809274cd0a4925c5f1023dc72eebb53b01c05a756e187f3f6ac3af8', 'prod-sql'),
  ('0030_devices_channel_nulls_not_distinct.sql',  '1e913e54222b332a64664586be843b71e59ca7b95d310a2da121515b867d3a9e', 'prod-sql')
ON CONFLICT (filename) DO NOTHING;

-- ── Verification ────────────────────────────────────────────────────────────
SELECT count(*) AS migrations_recorded FROM schema_migrations;
SELECT indexdef FROM pg_indexes WHERE indexname = 'devices_tenant_central_slave_channel_unique';
SELECT conname  FROM pg_constraint WHERE conname = 'devices_channel_range_check';

-- =============================================================================
-- CONCURRENTLY variant (only if `devices` is large and you must avoid the lock):
-- Run these OUTSIDE any transaction (no BEGIN/COMMIT), one at a time:
--
--   DROP INDEX IF EXISTS "devices_tenant_central_slave_channel_unique";
--   CREATE UNIQUE INDEX CONCURRENTLY "devices_tenant_central_slave_channel_unique"
--     ON "devices" ("tenant_id","central_id","slave_id","channel","device_channel_type")
--     NULLS NOT DISTINCT
--     WHERE "central_id" IS NOT NULL AND "slave_id" IS NOT NULL;
--
-- Then run section 2 (governance) separately. Note: while the index is dropped
-- and rebuilding, (central, slave) uniqueness is briefly unenforced.
-- =============================================================================
