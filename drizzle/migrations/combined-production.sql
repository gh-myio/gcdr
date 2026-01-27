-- Combined Migration for Production (0000 + 0001)
-- Run this in PostgreSQL via: psql -U postgres -d db_gcdr_prod -f combined-production.sql
-- Or copy-paste into Dokploy PostgreSQL terminal

-- ============================================================================
-- Migration 0000: Core tables
-- ============================================================================

CREATE TYPE "public"."actor_type" AS ENUM('USER', 'SYSTEM', 'API_KEY', 'SERVICE_ACCOUNT', 'ANONYMOUS');
CREATE TYPE "public"."asset_type" AS ENUM('BUILDING', 'FLOOR', 'ROOM', 'EQUIPMENT', 'ZONE', 'OTHER');
CREATE TYPE "public"."assignment_status" AS ENUM('active', 'inactive', 'expired');
CREATE TYPE "public"."audit_level" AS ENUM('MINIMAL', 'STANDARD', 'VERBOSE', 'DEBUG');
CREATE TYPE "public"."central_type" AS ENUM('NODEHUB', 'GATEWAY', 'EDGE_CONTROLLER', 'VIRTUAL');
CREATE TYPE "public"."connection_status" AS ENUM('ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE');
CREATE TYPE "public"."connectivity_status" AS ENUM('ONLINE', 'OFFLINE', 'UNKNOWN');
CREATE TYPE "public"."customer_type" AS ENUM('HOLDING', 'COMPANY', 'BRANCH', 'FRANCHISE');
CREATE TYPE "public"."device_protocol" AS ENUM('MQTT', 'HTTP', 'MODBUS', 'BACNET', 'LORAWAN', 'ZIGBEE', 'OTHER');
CREATE TYPE "public"."device_type" AS ENUM('SENSOR', 'ACTUATOR', 'GATEWAY', 'CONTROLLER', 'METER', 'CAMERA', 'OTHER');
CREATE TYPE "public"."entity_status" AS ENUM('ACTIVE', 'INACTIVE', 'DELETED');
CREATE TYPE "public"."event_category" AS ENUM('ENTITY_CHANGE', 'USER_ACTION', 'SYSTEM_EVENT', 'QUERY', 'AUTH', 'INTEGRATION');
CREATE TYPE "public"."group_type" AS ENUM('USER', 'DEVICE', 'ASSET', 'MIXED');
CREATE TYPE "public"."integration_type" AS ENUM('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL');
CREATE TYPE "public"."package_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'DEPRECATED', 'SUSPENDED');
CREATE TYPE "public"."partner_status" AS ENUM('PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED');
CREATE TYPE "public"."pricing_model" AS ENUM('FREE', 'PER_REQUEST', 'MONTHLY', 'ANNUAL', 'CUSTOM');
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high', 'critical');
CREATE TYPE "public"."rule_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "public"."rule_type" AS ENUM('ALARM_THRESHOLD', 'SLA', 'ESCALATION', 'MAINTENANCE_WINDOW');
CREATE TYPE "public"."scope_type" AS ENUM('GLOBAL', 'CUSTOMER', 'ASSET', 'DEVICE');
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION', 'LOCKED');
CREATE TYPE "public"."user_type" AS ENUM('INTERNAL', 'CUSTOMER', 'PARTNER', 'SERVICE_ACCOUNT');

CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"parent_asset_id" uuid,
	"path" text NOT NULL,
	"depth" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"type" "asset_type" NOT NULL,
	"description" text,
	"location" jsonb,
	"specs" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"event_category" "event_category" NOT NULL,
	"audit_level" "audit_level" DEFAULT 'STANDARD' NOT NULL,
	"description" varchar(500),
	"action" varchar(20) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"customer_id" uuid,
	"user_id" uuid,
	"user_email" varchar(255),
	"actor_type" "actor_type" DEFAULT 'USER' NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"request_id" uuid,
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"http_method" varchar(10),
	"http_path" varchar(500),
	"status_code" integer,
	"error_message" varchar(2000),
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_link" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "centrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"serial_number" varchar(100) NOT NULL,
	"type" "central_type" NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"connection_status" "connection_status" DEFAULT 'OFFLINE' NOT NULL,
	"firmware_version" varchar(50) NOT NULL,
	"software_version" varchar(50) NOT NULL,
	"last_update_at" timestamp with time zone,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"location" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "customer_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip" varchar(45),
	"usage_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_customer_id" uuid,
	"path" text NOT NULL,
	"depth" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"type" "customer_type" NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"theme" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"label" varchar(100),
	"type" "device_type" NOT NULL,
	"description" text,
	"serial_number" varchar(100) NOT NULL,
	"external_id" varchar(255),
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connectivity_status" "connectivity_status" DEFAULT 'UNKNOWN' NOT NULL,
	"last_connected_at" timestamp with time zone,
	"last_disconnected_at" timestamp with time zone,
	"credentials" jsonb,
	"telemetry_config" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"slave_id" smallint,
	"central_id" uuid,
	"identifier" varchar(255),
	"device_profile" varchar(100),
	"device_type" varchar(100),
	"ingestion_id" uuid,
	"ingestion_gateway_id" uuid,
	"last_activity_time" timestamp with time zone,
	"last_alarm_time" timestamp with time zone,
	CONSTRAINT "valid_slave_id" CHECK ("devices"."slave_id" IS NULL OR ("devices"."slave_id" >= 1 AND "devices"."slave_id" <= 247))
);

CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"code" varchar(50),
	"type" "group_type" NOT NULL,
	"purposes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"hierarchy" jsonb,
	"notification_settings" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_to_child_customers" boolean DEFAULT false NOT NULL,
	"editable_by_child_customers" boolean DEFAULT false NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "integration_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"long_description" text,
	"category" varchar(50) NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"icon_url" varchar(500),
	"documentation_url" varchar(500),
	"type" "integration_type" NOT NULL,
	"status" "package_status" DEFAULT 'DRAFT' NOT NULL,
	"current_version" varchar(50) NOT NULL,
	"versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publisher_id" uuid NOT NULL,
	"publisher_name" varchar(255) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"endpoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auth" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rate_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pricing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subscriber_count" integer DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"rejection_reason" text,
	"published_at" timestamp with time zone,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "look_and_feels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"mode" varchar(20) DEFAULT 'light' NOT NULL,
	"colors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dark_mode_colors" jsonb,
	"typography" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brand_name" varchar(255),
	"tagline" varchar(500),
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_css" jsonb,
	"inherit_from_parent" boolean DEFAULT true NOT NULL,
	"parent_theme_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "package_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"package_version" varchar(50) NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"subscriber_type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"subscribed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"config" jsonb,
	"usage_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "partner_status" DEFAULT 'PENDING' NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"company_website" varchar(255) NOT NULL,
	"company_description" text NOT NULL,
	"industry" varchar(100) NOT NULL,
	"country" varchar(100) NOT NULL,
	"contact_name" varchar(255) NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(50),
	"technical_contact_email" varchar(255) NOT NULL,
	"webhook_url" varchar(500),
	"ip_whitelist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"api_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"oauth_clients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhooks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 100 NOT NULL,
	"rate_limit_per_day" integer DEFAULT 10000 NOT NULL,
	"monthly_quota" integer DEFAULT 100000 NOT NULL,
	"subscribed_packages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_packages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejection_reason" text,
	"suspended_at" timestamp with time zone,
	"suspended_by" uuid,
	"suspension_reason" text,
	"activated_at" timestamp with time zone,
	"activated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"allow" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deny" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb,
	"risk_level" "risk_level" DEFAULT 'low' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_key" varchar(100) NOT NULL,
	"scope" text NOT NULL,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"policies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "risk_level" DEFAULT 'low' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" "rule_type" NOT NULL,
	"priority" "rule_priority" DEFAULT 'MEDIUM' NOT NULL,
	"scope_type" "scope_type" DEFAULT 'GLOBAL' NOT NULL,
	"scope_entity_id" uuid,
	"scope_inherited" boolean DEFAULT false NOT NULL,
	"alarm_config" jsonb,
	"sla_config" jsonb,
	"escalation_config" jsonb,
	"maintenance_config" jsonb,
	"notification_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "valid_alarm_config" CHECK ("rules"."type" != 'ALARM_THRESHOLD' OR "rules"."alarm_config" IS NOT NULL),
	CONSTRAINT "valid_sla_config" CHECK ("rules"."type" != 'SLA' OR "rules"."sla_config" IS NOT NULL),
	CONSTRAINT "valid_escalation_config" CHECK ("rules"."type" != 'ESCALATION' OR "rules"."escalation_config" IS NOT NULL),
	CONSTRAINT "valid_maintenance_config" CHECK ("rules"."type" != 'MAINTENANCE_WINDOW' OR "rules"."maintenance_config" IS NOT NULL),
	CONSTRAINT "valid_scope_entity" CHECK ("rules"."scope_type" = 'GLOBAL' OR "rules"."scope_entity_id" IS NOT NULL)
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"partner_id" uuid,
	"email" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"username" varchar(100),
	"external_id" varchar(255),
	"type" "user_type" DEFAULT 'CUSTOMER' NOT NULL,
	"status" "user_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"security" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_sessions" integer DEFAULT 0 NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone,
	"invitation_accepted_at" timestamp with time zone,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);

ALTER TABLE "assets" ADD CONSTRAINT "assets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "centrals" ADD CONSTRAINT "centrals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "centrals" ADD CONSTRAINT "centrals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "customer_api_keys" ADD CONSTRAINT "customer_api_keys_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "devices" ADD CONSTRAINT "devices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "devices" ADD CONSTRAINT "devices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "groups" ADD CONSTRAINT "groups_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "integration_packages" ADD CONSTRAINT "integration_packages_publisher_id_partners_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "look_and_feels" ADD CONSTRAINT "look_and_feels_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "package_subscriptions" ADD CONSTRAINT "package_subscriptions_package_id_integration_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."integration_packages"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rules" ADD CONSTRAINT "rules_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "users" ADD CONSTRAINT "users_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "assets_tenant_customer_code_unique" ON "assets" USING btree ("tenant_id","customer_id","code");
CREATE INDEX "assets_tenant_customer_idx" ON "assets" USING btree ("tenant_id","customer_id");
CREATE INDEX "assets_tenant_parent_idx" ON "assets" USING btree ("tenant_id","parent_asset_id");
CREATE INDEX "assets_tenant_path_idx" ON "assets" USING btree ("tenant_id","path");
CREATE INDEX "audit_logs_tenant_entity_idx" ON "audit_logs" USING btree ("tenant_id","entity_type","entity_id");
CREATE INDEX "audit_logs_tenant_user_idx" ON "audit_logs" USING btree ("tenant_id","user_id");
CREATE INDEX "audit_logs_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at");
CREATE INDEX "audit_logs_tenant_event_type_idx" ON "audit_logs" USING btree ("tenant_id","event_type");
CREATE INDEX "audit_logs_tenant_customer_idx" ON "audit_logs" USING btree ("tenant_id","customer_id");
CREATE INDEX "audit_logs_tenant_category_idx" ON "audit_logs" USING btree ("tenant_id","event_category");
CREATE INDEX "audit_logs_tenant_action_idx" ON "audit_logs" USING btree ("tenant_id","action");
CREATE INDEX "audit_logs_tenant_level_idx" ON "audit_logs" USING btree ("tenant_id","audit_level");
CREATE UNIQUE INDEX "centrals_tenant_serial_unique" ON "centrals" USING btree ("tenant_id","serial_number");
CREATE INDEX "centrals_tenant_customer_idx" ON "centrals" USING btree ("tenant_id","customer_id");
CREATE INDEX "centrals_tenant_asset_idx" ON "centrals" USING btree ("tenant_id","asset_id");
CREATE UNIQUE INDEX "customer_api_keys_hash_unique" ON "customer_api_keys" USING btree ("key_hash");
CREATE INDEX "customer_api_keys_tenant_customer_idx" ON "customer_api_keys" USING btree ("tenant_id","customer_id");
CREATE INDEX "customer_api_keys_prefix_idx" ON "customer_api_keys" USING btree ("key_prefix");
CREATE INDEX "customer_api_keys_active_idx" ON "customer_api_keys" USING btree ("is_active");
CREATE UNIQUE INDEX "customers_tenant_code_unique" ON "customers" USING btree ("tenant_id","code");
CREATE INDEX "customers_tenant_parent_idx" ON "customers" USING btree ("tenant_id","parent_customer_id");
CREATE INDEX "customers_tenant_path_idx" ON "customers" USING btree ("tenant_id","path");
CREATE INDEX "customers_tenant_type_idx" ON "customers" USING btree ("tenant_id","type");
CREATE INDEX "customers_tenant_status_idx" ON "customers" USING btree ("tenant_id","status");
CREATE UNIQUE INDEX "devices_tenant_serial_unique" ON "devices" USING btree ("tenant_id","serial_number");
CREATE INDEX "devices_tenant_asset_idx" ON "devices" USING btree ("tenant_id","asset_id");
CREATE INDEX "devices_tenant_customer_idx" ON "devices" USING btree ("tenant_id","customer_id");
CREATE INDEX "devices_external_id_idx" ON "devices" USING btree ("external_id");
CREATE INDEX "devices_slave_id_idx" ON "devices" USING btree ("tenant_id","slave_id");
CREATE INDEX "devices_central_id_idx" ON "devices" USING btree ("tenant_id","central_id");
CREATE INDEX "devices_identifier_idx" ON "devices" USING btree ("tenant_id","identifier");
CREATE INDEX "devices_device_profile_idx" ON "devices" USING btree ("tenant_id","device_profile");
CREATE INDEX "devices_device_type_idx" ON "devices" USING btree ("tenant_id","device_type");
CREATE INDEX "devices_ingestion_id_idx" ON "devices" USING btree ("tenant_id","ingestion_id");
CREATE INDEX "devices_ingestion_gateway_id_idx" ON "devices" USING btree ("tenant_id","ingestion_gateway_id");
CREATE INDEX "devices_last_activity_time_idx" ON "devices" USING btree ("tenant_id","last_activity_time");
CREATE INDEX "devices_last_alarm_time_idx" ON "devices" USING btree ("tenant_id","last_alarm_time");
CREATE UNIQUE INDEX "devices_tenant_identifier_unique" ON "devices" USING btree ("tenant_id","identifier");
CREATE UNIQUE INDEX "devices_tenant_central_slave_unique" ON "devices" USING btree ("tenant_id","central_id","slave_id");
CREATE UNIQUE INDEX "groups_tenant_customer_code_unique" ON "groups" USING btree ("tenant_id","customer_id","code");
CREATE INDEX "groups_tenant_customer_idx" ON "groups" USING btree ("tenant_id","customer_id");
CREATE INDEX "groups_tenant_type_idx" ON "groups" USING btree ("tenant_id","type");
CREATE UNIQUE INDEX "integration_packages_tenant_slug_unique" ON "integration_packages" USING btree ("tenant_id","slug");
CREATE INDEX "integration_packages_tenant_status_idx" ON "integration_packages" USING btree ("tenant_id","status");
CREATE INDEX "integration_packages_tenant_category_idx" ON "integration_packages" USING btree ("tenant_id","category");
CREATE INDEX "integration_packages_tenant_publisher_idx" ON "integration_packages" USING btree ("tenant_id","publisher_id");
CREATE INDEX "look_and_feels_tenant_customer_idx" ON "look_and_feels" USING btree ("tenant_id","customer_id");
CREATE INDEX "look_and_feels_tenant_default_idx" ON "look_and_feels" USING btree ("tenant_id","is_default");
CREATE UNIQUE INDEX "package_subscriptions_unique" ON "package_subscriptions" USING btree ("package_id","subscriber_id");
CREATE INDEX "package_subscriptions_tenant_subscriber_idx" ON "package_subscriptions" USING btree ("tenant_id","subscriber_id");
CREATE INDEX "package_subscriptions_tenant_status_idx" ON "package_subscriptions" USING btree ("tenant_id","status");
CREATE UNIQUE INDEX "partners_tenant_company_unique" ON "partners" USING btree ("tenant_id","company_name");
CREATE INDEX "partners_tenant_status_idx" ON "partners" USING btree ("tenant_id","status");
CREATE UNIQUE INDEX "policies_tenant_key_unique" ON "policies" USING btree ("tenant_id","key");
CREATE INDEX "policies_tenant_system_idx" ON "policies" USING btree ("tenant_id","is_system");
CREATE UNIQUE INDEX "role_assignments_unique" ON "role_assignments" USING btree ("tenant_id","user_id","role_key","scope");
CREATE INDEX "role_assignments_tenant_user_idx" ON "role_assignments" USING btree ("tenant_id","user_id");
CREATE INDEX "role_assignments_tenant_role_idx" ON "role_assignments" USING btree ("tenant_id","role_key");
CREATE INDEX "role_assignments_tenant_status_idx" ON "role_assignments" USING btree ("tenant_id","status");
CREATE UNIQUE INDEX "roles_tenant_key_unique" ON "roles" USING btree ("tenant_id","key");
CREATE INDEX "roles_tenant_system_idx" ON "roles" USING btree ("tenant_id","is_system");
CREATE INDEX "rules_tenant_customer_idx" ON "rules" USING btree ("tenant_id","customer_id");
CREATE INDEX "rules_tenant_type_idx" ON "rules" USING btree ("tenant_id","type");
CREATE INDEX "rules_tenant_priority_idx" ON "rules" USING btree ("tenant_id","priority");
CREATE INDEX "rules_tenant_enabled_idx" ON "rules" USING btree ("tenant_id","enabled");
CREATE INDEX "rules_tenant_scope_idx" ON "rules" USING btree ("tenant_id","scope_type");
CREATE UNIQUE INDEX "users_tenant_email_unique" ON "users" USING btree ("tenant_id","email");
CREATE INDEX "users_tenant_customer_idx" ON "users" USING btree ("tenant_id","customer_id");
CREATE INDEX "users_tenant_status_idx" ON "users" USING btree ("tenant_id","status");
CREATE INDEX "users_tenant_type_idx" ON "users" USING btree ("tenant_id","type");

-- ============================================================================
-- Migration 0001: Simulator tables
-- ============================================================================

CREATE TYPE "public"."simulator_session_status" AS ENUM('PENDING', 'RUNNING', 'STOPPED', 'EXPIRED', 'ERROR');

CREATE TABLE "simulator_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"event_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "simulator_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" "simulator_session_status" DEFAULT 'PENDING' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scans_count" integer DEFAULT 0 NOT NULL,
	"scans_limit" integer NOT NULL,
	"bundle_version" varchar(50),
	"bundle_signature" varchar(128),
	"bundle_fetched_at" timestamp with time zone,
	"alarms_triggered_count" integer DEFAULT 0 NOT NULL,
	"last_scan_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "simulator_events" ADD CONSTRAINT "simulator_events_session_id_simulator_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulator_sessions"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "sim_events_session_idx" ON "simulator_events" USING btree ("session_id");
CREATE INDEX "sim_events_created_idx" ON "simulator_events" USING btree ("created_at");
CREATE INDEX "sim_events_session_type_idx" ON "simulator_events" USING btree ("session_id","event_type");
CREATE INDEX "sim_sessions_tenant_idx" ON "simulator_sessions" USING btree ("tenant_id");
CREATE INDEX "sim_sessions_status_idx" ON "simulator_sessions" USING btree ("status");
CREATE INDEX "sim_sessions_tenant_status_idx" ON "simulator_sessions" USING btree ("tenant_id","status");
CREATE INDEX "sim_sessions_expires_idx" ON "simulator_sessions" USING btree ("expires_at");

-- ============================================================================
-- Drizzle migration tracking table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
);

INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES
    ('0000_third_tempest', EXTRACT(EPOCH FROM NOW())::bigint * 1000),
    ('0001_fuzzy_mojo', EXTRACT(EPOCH FROM NOW())::bigint * 1000);

-- ============================================================================
-- Done! Run seeds next via the API container with: npm run db:seed
-- ============================================================================
