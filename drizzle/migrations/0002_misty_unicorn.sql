CREATE TYPE "public"."equipment_type" AS ENUM('hidrometro', 'medidor', 'sensor', 'termometro', 'analisador', 'controlador', 'gateway', 'other');--> statement-breakpoint
CREATE TYPE "public"."feature_access_type" AS ENUM('guaranteed', 'granted', 'conditional', 'denied', 'not_granted');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('entry', 'common_area', 'stores', 'internal', 'external', 'parking', 'roof', 'basement', 'other');--> statement-breakpoint
CREATE TYPE "public"."verification_token_type" AS ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'ACCOUNT_UNLOCK');--> statement-breakpoint
CREATE TABLE "domain_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"domain" varchar(50) NOT NULL,
	"equipment" varchar(50) NOT NULL,
	"location" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"display_name" varchar(255),
	"description" text,
	"risk_level" "risk_level" DEFAULT 'low' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"customer_id" uuid,
	"member_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_bundle_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" varchar(255) NOT NULL,
	"bundle" jsonb NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_maintenance_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_type" "verification_token_type" NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'UNVERIFIED'::text;--> statement-breakpoint
DROP TYPE "public"."user_status";--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('UNVERIFIED', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'LOCKED');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'UNVERIFIED'::"public"."user_status";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "status" SET DATA TYPE "public"."user_status" USING "status"::"public"."user_status";--> statement-breakpoint
ALTER TABLE "maintenance_groups" ADD CONSTRAINT "maintenance_groups_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bundle_cache" ADD CONSTRAINT "user_bundle_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_maintenance_groups" ADD CONSTRAINT "user_maintenance_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_maintenance_groups" ADD CONSTRAINT "user_maintenance_groups_group_id_maintenance_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."maintenance_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_permissions_unique" ON "domain_permissions" USING btree ("tenant_id","domain","equipment","location","action");--> statement-breakpoint
CREATE INDEX "domain_permissions_domain_idx" ON "domain_permissions" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domain_permissions_equipment_idx" ON "domain_permissions" USING btree ("equipment");--> statement-breakpoint
CREATE INDEX "domain_permissions_location_idx" ON "domain_permissions" USING btree ("location");--> statement-breakpoint
CREATE INDEX "domain_permissions_tenant_active_idx" ON "domain_permissions" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_groups_tenant_key_unique" ON "maintenance_groups" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "maintenance_groups_tenant_customer_idx" ON "maintenance_groups" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "maintenance_groups_tenant_active_idx" ON "maintenance_groups" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "user_bundle_cache_unique" ON "user_bundle_cache" USING btree ("tenant_id","user_id","scope");--> statement-breakpoint
CREATE INDEX "user_bundle_cache_tenant_user_idx" ON "user_bundle_cache" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "user_bundle_cache_expires_idx" ON "user_bundle_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_bundle_cache_invalidated_idx" ON "user_bundle_cache" USING btree ("invalidated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_maintenance_groups_unique" ON "user_maintenance_groups" USING btree ("user_id","group_id");--> statement-breakpoint
CREATE INDEX "user_maintenance_groups_tenant_user_idx" ON "user_maintenance_groups" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "user_maintenance_groups_tenant_group_idx" ON "user_maintenance_groups" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_idx" ON "verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_tokens_type_idx" ON "verification_tokens" USING btree ("token_type");--> statement-breakpoint
CREATE INDEX "verification_tokens_expires_idx" ON "verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verification_tokens_tenant_user_type_idx" ON "verification_tokens" USING btree ("tenant_id","user_id","token_type");