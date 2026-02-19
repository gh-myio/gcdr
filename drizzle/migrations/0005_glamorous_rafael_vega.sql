CREATE TABLE "alarm_bundle_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"version" varchar(50) NOT NULL,
	"previous_version" varchar(50),
	"bundle_type" varchar(10) NOT NULL,
	"reason" varchar(255) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid,
	"rules_count" integer DEFAULT 0 NOT NULL,
	"devices_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE INDEX "abv_tenant_customer_idx" ON "alarm_bundle_versions" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "abv_version_idx" ON "alarm_bundle_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "abv_created_at_idx" ON "alarm_bundle_versions" USING btree ("created_at");