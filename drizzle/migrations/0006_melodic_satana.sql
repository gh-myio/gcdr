ALTER TABLE "customers" ADD COLUMN "external_id" varchar(255);--> statement-breakpoint
CREATE INDEX "customers_external_id_idx" ON "customers" USING btree ("external_id");