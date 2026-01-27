CREATE TYPE "public"."simulator_session_status" AS ENUM('PENDING', 'RUNNING', 'STOPPED', 'EXPIRED', 'ERROR');--> statement-breakpoint
CREATE TABLE "simulator_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"event_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "simulator_events" ADD CONSTRAINT "simulator_events_session_id_simulator_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulator_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sim_events_session_idx" ON "simulator_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sim_events_created_idx" ON "simulator_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sim_events_session_type_idx" ON "simulator_events" USING btree ("session_id","event_type");--> statement-breakpoint
CREATE INDEX "sim_sessions_tenant_idx" ON "simulator_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sim_sessions_status_idx" ON "simulator_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sim_sessions_tenant_status_idx" ON "simulator_sessions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "sim_sessions_expires_idx" ON "simulator_sessions" USING btree ("expires_at");