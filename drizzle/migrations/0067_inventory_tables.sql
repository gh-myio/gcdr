-- Migration 0067: RFC-0061 — Inventory & Warehouse Management ("Menu de Estoque")
--
-- Creates the full `inv_*` schema in one shot (P0 requirement A4 — no dangling
-- FKs in later phases). Balance is ALWAYS derived from inv_stock_movements
-- (DEC-2, never stored); the SQL view inv_item_stock is the read aggregate.
-- Tables are created in topological FK order. Enums are text + CHECK following
-- the existing schema style. Advanced index shapes live here (authoritative):
--   - covering index INCLUDE (quantity) on the ledger (W2)
--   - partial UNIQUE (tenant_id, purchase_order_id) WHERE type='ENTRADA' — the
--     receipt-entry idempotency guarantee by constraint (A1)
--   - partial UNIQUE on box_qr / label WHERE NOT NULL
--
-- NOTE: numbering may collide with PR #20 (also drafting 0067/0068) —
-- coordinate before merge (see RFC §Migration & import step 1).

-- M1 — unified catalog (DEC-1)
CREATE TABLE inv_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  name            text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  domain          text NOT NULL,
  link            text,
  description     text,
  is_manufactured boolean NOT NULL DEFAULT false,
  loss_percent    numeric(6,2) NOT NULL DEFAULT 0,
  lot_quantity    integer,
  purchase_type   text,
  photo_file_id   uuid REFERENCES file_assets(id) ON DELETE SET NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT inv_items_domain_check CHECK (domain IN ('COMPONENT','PRODUCT','THIRD_PARTY','TOOL')),
  CONSTRAINT inv_items_purchase_type_check CHECK (purchase_type IS NULL OR purchase_type IN ('NACIONAL','IMPORTACAO')),
  CONSTRAINT inv_items_manufactured_check CHECK (NOT is_manufactured OR domain = 'PRODUCT')
);
CREATE UNIQUE INDEX inv_items_uq ON inv_items (tenant_id, domain, normalized_name);
CREATE INDEX inv_items_tenant_idx ON inv_items (tenant_id, domain);

-- M5 — single QR identity source (A2)
CREATE TABLE inv_qr_registry (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  qr_value   text NOT NULL,
  kind       text NOT NULL,
  item_id    uuid REFERENCES inv_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT inv_qr_registry_kind_check CHECK (kind IN ('UNIT','BOX'))
);
CREATE UNIQUE INDEX inv_qr_registry_uq ON inv_qr_registry (tenant_id, qr_value);

-- M1 — BOM
CREATE TABLE inv_boms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  product_item_id   uuid NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  component_item_id uuid NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  quantity          numeric(12,3) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  CONSTRAINT inv_boms_quantity_check CHECK (quantity > 0)
);
CREATE UNIQUE INDEX inv_boms_uq ON inv_boms (product_item_id, component_item_id);
CREATE INDEX inv_boms_product_idx ON inv_boms (tenant_id, product_item_id);

-- M9 — projects
CREATE TABLE inv_projects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  name               text NOT NULL,
  description        text,
  customer_id        uuid REFERENCES customers(id) ON DELETE SET NULL,
  legacy_client_name text,
  legacy_client_cnpj text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid
);
CREATE INDEX inv_projects_tenant_idx ON inv_projects (tenant_id);

-- M3 — purchase orders
CREATE TABLE inv_purchase_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  project_id         uuid NOT NULL REFERENCES inv_projects(id) ON DELETE RESTRICT,
  requester_id       uuid,
  item_id            uuid NOT NULL REFERENCES inv_items(id) ON DELETE RESTRICT,
  item_name_snapshot text,
  item_link          text,
  quantity           integer NOT NULL,
  recipient          text,
  delivery_point     text,
  status             text NOT NULL DEFAULT 'PENDENTE',
  deadline_type      text,
  deadline_date      timestamptz,
  delivery_forecast  timestamptz,
  requester_notes    text,
  buyer_notes        text,
  passphrase         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  CONSTRAINT inv_purchase_orders_status_check CHECK (status IN ('PENDENTE','COMPRADO_AGUARDANDO','ENTREGUE','RECEBIDO_OK','RECEBIDO_PROBLEMA','CANCELADO')),
  CONSTRAINT inv_purchase_orders_deadline_type_check CHECK (deadline_type IS NULL OR deadline_type IN ('URGENTE','ESTA_SEMANA','ESTE_MES','CUSTOMIZADO')),
  CONSTRAINT inv_purchase_orders_quantity_check CHECK (quantity BETWEEN 1 AND 100000)
);
CREATE INDEX inv_purchase_orders_status_idx ON inv_purchase_orders (tenant_id, status);
CREATE INDEX inv_purchase_orders_project_idx ON inv_purchase_orders (tenant_id, project_id);

CREATE TABLE inv_purchase_order_files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  order_id   uuid NOT NULL REFERENCES inv_purchase_orders(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX inv_purchase_order_files_order_idx ON inv_purchase_order_files (order_id);

CREATE TABLE inv_purchase_order_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  order_id   uuid NOT NULL REFERENCES inv_purchase_orders(id) ON DELETE CASCADE,
  actor_id   uuid,
  event_type text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_purchase_order_events_type_check CHECK (event_type IN ('CRIADO','STATUS_ALTERADO','OBSERVACAO_ATUALIZADA'))
);
CREATE INDEX inv_purchase_order_events_chrono_idx ON inv_purchase_order_events (order_id, created_at);

-- M2 — event-sourced stock ledger (DEC-2/DEC-3)
CREATE TABLE inv_stock_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  item_id           uuid NOT NULL REFERENCES inv_items(id) ON DELETE RESTRICT,
  location          text NOT NULL,
  quantity          numeric(12,3) NOT NULL,
  type              text NOT NULL,
  reason            text,
  responsible       text,
  photo_file_id     uuid REFERENCES file_assets(id) ON DELETE SET NULL,
  purchase_order_id uuid REFERENCES inv_purchase_orders(id) ON DELETE SET NULL,
  transfer_group_id uuid,
  imported          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  CONSTRAINT inv_stock_movements_type_check CHECK (type IN ('ENTRADA','SAIDA','AJUSTE','TRANSFERENCIA_IN','TRANSFERENCIA_OUT')),
  CONSTRAINT inv_stock_movements_location_check CHECK (location IN ('FABRICA','ALMOXARIFADO','ALMOXARIFADO_GERAL')),
  CONSTRAINT inv_stock_movements_quantity_check CHECK (quantity > 0)
);
-- Covering index (W2): balance = Σ by (item, location, type) with quantity inline.
CREATE INDEX inv_stock_movements_balance_idx
  ON inv_stock_movements (tenant_id, item_id, location, type) INCLUDE (quantity);
-- Receipt-entry idempotency by constraint (A1): at most one ENTRADA per PO.
-- NULL purchase_order_id rows are distinct, so manual entries are unaffected.
CREATE UNIQUE INDEX inv_stock_movements_po_entry_uq
  ON inv_stock_movements (tenant_id, purchase_order_id)
  WHERE type = 'ENTRADA' AND purchase_order_id IS NOT NULL;

-- M4 — assembly
CREATE TABLE inv_assembly_releases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  photo_file_id uuid NOT NULL REFERENCES file_assets(id) ON DELETE RESTRICT,
  responsibles  uuid[] NOT NULL DEFAULT '{}'::uuid[],
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX inv_assembly_releases_tenant_idx ON inv_assembly_releases (tenant_id);

CREATE TABLE inv_assembly_release_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  release_id uuid NOT NULL REFERENCES inv_assembly_releases(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES inv_items(id) ON DELETE RESTRICT,
  quantity   integer NOT NULL,
  CONSTRAINT inv_assembly_release_items_quantity_check CHECK (quantity > 0)
);
CREATE INDEX inv_assembly_release_items_release_idx ON inv_assembly_release_items (release_id);

CREATE TABLE inv_assembly_release_issues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  release_id        uuid NOT NULL REFERENCES inv_assembly_releases(id) ON DELETE CASCADE,
  release_item_id   uuid REFERENCES inv_assembly_release_items(id) ON DELETE CASCADE,
  item_id           uuid REFERENCES inv_items(id) ON DELETE SET NULL,
  reported_quantity integer,
  message           text,
  status            text NOT NULL DEFAULT 'ABERTA',
  resolution_note   text,
  reported_by       uuid,
  resolved_by       uuid,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_assembly_release_issues_status_check CHECK (status IN ('ABERTA','RESOLVIDA'))
);
CREATE INDEX inv_assembly_release_issues_release_idx ON inv_assembly_release_issues (release_id);

-- M5 — homologation
CREATE TABLE inv_homologations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  release_id     uuid REFERENCES inv_assembly_releases(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  box_size       integer NOT NULL,
  box_qr         text,
  responsible_id uuid,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  CONSTRAINT inv_homologations_box_size_check CHECK (box_size IN (1,10,50,100,224))
);
CREATE INDEX inv_homologations_item_idx ON inv_homologations (tenant_id, item_id);
CREATE UNIQUE INDEX inv_homologations_box_qr_uq ON inv_homologations (tenant_id, box_qr) WHERE box_qr IS NOT NULL;

CREATE TABLE inv_homologation_units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  homologation_id uuid NOT NULL REFERENCES inv_homologations(id) ON DELETE CASCADE,
  position        integer,
  qr_value        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inv_homologation_units_qr_uq ON inv_homologation_units (tenant_id, qr_value);
CREATE INDEX inv_homologation_units_homolog_idx ON inv_homologation_units (homologation_id);

CREATE TABLE inv_movement_qrs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  movement_id          uuid NOT NULL REFERENCES inv_stock_movements(id) ON DELETE CASCADE,
  qr_value             text,
  box_qr               text,
  homologation_unit_id uuid REFERENCES inv_homologation_units(id) ON DELETE SET NULL
);
CREATE INDEX inv_movement_qrs_qr_value_idx ON inv_movement_qrs (qr_value);
CREATE INDEX inv_movement_qrs_movement_idx ON inv_movement_qrs (movement_id);

-- M6 — expedition
CREATE TABLE inv_expedition_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  title          text,
  project_id     uuid REFERENCES inv_projects(id) ON DELETE RESTRICT,
  customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,
  delivery_date  timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'PENDENTE',
  is_replacement boolean NOT NULL DEFAULT false,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  CONSTRAINT inv_expedition_orders_status_check CHECK (status IN ('PENDENTE','PRODUZINDO','PRONTO_ENTREGA','EM_TRANSITO','ENTREGUE_CLIENTE','PERDIDO'))
);
CREATE INDEX inv_expedition_orders_status_idx ON inv_expedition_orders (tenant_id, status);

CREATE TABLE inv_expedition_order_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  order_id  uuid NOT NULL REFERENCES inv_expedition_orders(id) ON DELETE CASCADE,
  item_id   uuid NOT NULL REFERENCES inv_items(id) ON DELETE RESTRICT,
  quantity  integer NOT NULL,
  CONSTRAINT inv_expedition_order_items_quantity_check CHECK (quantity > 0)
);
CREATE INDEX inv_expedition_order_items_order_idx ON inv_expedition_order_items (order_id);

-- M4 — demand resolution (schema in P0, endpoints in P3 — A4)
CREATE TABLE inv_production_demands (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  expedition_order_item_id uuid NOT NULL,
  expedition_order_id      uuid REFERENCES inv_expedition_orders(id) ON DELETE CASCADE,
  item_id                  uuid REFERENCES inv_items(id) ON DELETE SET NULL,
  quantity                 integer NOT NULL,
  status                   text NOT NULL DEFAULT 'PENDENTE',
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_production_demands_status_check CHECK (status IN ('PENDENTE','CONCLUIDO'))
);
CREATE UNIQUE INDEX inv_production_demands_order_item_uq ON inv_production_demands (expedition_order_item_id);

CREATE TABLE inv_purchase_demands (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL,
  expedition_order_item_id uuid NOT NULL,
  expedition_order_id      uuid REFERENCES inv_expedition_orders(id) ON DELETE CASCADE,
  purchase_order_id        uuid REFERENCES inv_purchase_orders(id) ON DELETE SET NULL,
  item_id                  uuid REFERENCES inv_items(id) ON DELETE SET NULL,
  quantity                 integer NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inv_purchase_demands_order_item_uq ON inv_purchase_demands (expedition_order_item_id);

CREATE TABLE inv_item_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  order_id      uuid NOT NULL REFERENCES inv_expedition_orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES inv_expedition_order_items(id) ON DELETE CASCADE,
  quantity      integer NOT NULL,
  photo_file_id uuid NOT NULL REFERENCES file_assets(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX inv_item_deliveries_order_idx ON inv_item_deliveries (order_id);

CREATE TABLE inv_delivery_qrs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  delivery_id          uuid NOT NULL REFERENCES inv_item_deliveries(id) ON DELETE CASCADE,
  order_item_id        uuid NOT NULL REFERENCES inv_expedition_order_items(id) ON DELETE CASCADE,
  qr_value             text,
  box_qr               text,
  homologation_unit_id uuid REFERENCES inv_homologation_units(id) ON DELETE SET NULL
);
CREATE INDEX inv_delivery_qrs_qr_value_idx ON inv_delivery_qrs (qr_value);
CREATE INDEX inv_delivery_qrs_delivery_idx ON inv_delivery_qrs (delivery_id);

CREATE TABLE inv_shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  order_id        uuid NOT NULL REFERENCES inv_expedition_orders(id) ON DELETE CASCADE,
  address         text,
  shipping_method text NOT NULL,
  responsible     text,
  tracking_code   text,
  proof_file_id   uuid NOT NULL REFERENCES file_assets(id) ON DELETE RESTRICT,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT inv_shipments_method_check CHECK (shipping_method IN ('AZUL_CARGO','CORREIOS','CARRO_MYIO','UBER'))
);
CREATE INDEX inv_shipments_order_idx ON inv_shipments (order_id);

-- M7 — field
CREATE TABLE inv_unit_products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  item_id              uuid REFERENCES inv_items(id) ON DELETE SET NULL,
  label                text,
  status               text NOT NULL DEFAULT 'PARADO',
  installed_at         timestamptz,
  project_id           uuid REFERENCES inv_projects(id) ON DELETE SET NULL,
  customer_id          uuid REFERENCES customers(id) ON DELETE SET NULL,
  client_name_snapshot text,
  expedition_order_id  uuid REFERENCES inv_expedition_orders(id) ON DELETE SET NULL,
  moved_to             text,
  moved_technician     text,
  move_photo_file_id   uuid REFERENCES file_assets(id) ON DELETE SET NULL,
  moved_at             timestamptz,
  move_notes           text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_unit_products_status_check CHECK (status IN ('PARADO','INSTALADO')),
  CONSTRAINT inv_unit_products_moved_to_check CHECK (moved_to IS NULL OR moved_to IN ('TECNICO','ALMOXARIFADO','PERDIDO','AVARIADO'))
);
CREATE UNIQUE INDEX inv_unit_products_label_uq ON inv_unit_products (tenant_id, label) WHERE label IS NOT NULL;

CREATE TABLE inv_technician_moves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  movement_id uuid REFERENCES inv_stock_movements(id) ON DELETE CASCADE,
  item_id     uuid REFERENCES inv_items(id) ON DELETE CASCADE,
  technician  text,
  destination text NOT NULL,
  project_id  uuid REFERENCES inv_projects(id) ON DELETE SET NULL,
  quantity    integer NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  CONSTRAINT inv_technician_moves_destination_check CHECK (destination IN ('UNIDADE','PERDIDO','ALMOXARIFADO','AVARIADO')),
  CONSTRAINT inv_technician_moves_quantity_check CHECK (quantity > 0)
);
CREATE INDEX inv_technician_moves_item_idx ON inv_technician_moves (tenant_id, item_id);

CREATE TABLE inv_damaged_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  item_id              uuid REFERENCES inv_items(id) ON DELETE SET NULL,
  product_name_snapshot text,
  quantity             integer NOT NULL,
  source               text,
  source_detail        text,
  reason               text,
  photo_file_id        uuid REFERENCES file_assets(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'AVARIADO',
  recovered_to         text,
  recovery_notes       text,
  recovered_by         uuid,
  recovered_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  CONSTRAINT inv_damaged_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT inv_damaged_items_status_check CHECK (status IN ('AVARIADO','RECUPERADO'))
);
CREATE INDEX inv_damaged_items_tenant_idx ON inv_damaged_items (tenant_id, status);

-- M8 — external mirror + sync + push outbox
CREATE TABLE inv_external_states (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  code                 text NOT NULL,
  product_type         text,
  location             text,
  status               text,
  technician           text,
  client_name          text,
  qr_value             text,
  item_id              uuid REFERENCES inv_items(id) ON DELETE SET NULL,
  homologation_unit_id uuid REFERENCES inv_homologation_units(id) ON DELETE SET NULL,
  last_change_at       timestamptz,
  payload              jsonb,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inv_external_states_code_uq ON inv_external_states (tenant_id, code);
CREATE INDEX inv_external_states_qr_value_idx ON inv_external_states (qr_value);

CREATE TABLE inv_external_sync_state (
  tenant_id    uuid PRIMARY KEY,
  lease_until  timestamptz,
  last_run_at  timestamptz,
  last_status  text,
  last_message text,
  total_items  integer,
  CONSTRAINT inv_external_sync_state_status_check CHECK (last_status IS NULL OR last_status IN ('OK','PARCIAL','ERRO'))
);

CREATE TABLE inv_external_push_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  qr_codes        text[] NOT NULL DEFAULT '{}'::text[],
  location        text,
  status          text NOT NULL DEFAULT 'PENDING',
  technician      text,
  client_name     text,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error      text,
  dispatched_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_external_push_outbox_status_check CHECK (status IN ('PENDING','FAILED','DONE'))
);
CREATE INDEX inv_external_push_outbox_drain_idx ON inv_external_push_outbox (tenant_id, status, next_attempt_at);

-- Derived balance view (DEC-2). AJUSTE counts as IN (source semantics).
-- TRANSFERENCIA_IN adds, TRANSFERENCIA_OUT/SAIDA subtract.
CREATE VIEW inv_item_stock AS
SELECT
  tenant_id,
  item_id,
  location,
  SUM(CASE WHEN type IN ('ENTRADA','AJUSTE','TRANSFERENCIA_IN') THEN quantity ELSE 0 END)
    - SUM(CASE WHEN type IN ('SAIDA','TRANSFERENCIA_OUT') THEN quantity ELSE 0 END) AS balance,
  SUM(CASE WHEN type IN ('ENTRADA','AJUSTE','TRANSFERENCIA_IN') THEN quantity ELSE 0 END) AS total_in,
  SUM(CASE WHEN type IN ('SAIDA','TRANSFERENCIA_OUT') THEN quantity ELSE 0 END) AS total_out,
  MAX(created_at) AS last_movement_at
FROM inv_stock_movements
GROUP BY tenant_id, item_id, location;
