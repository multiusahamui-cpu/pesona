CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"vertical" text NOT NULL,
	"status" text NOT NULL,
	"consumer_id" text,
	"partner_id" text,
	"gross_fare" bigint NOT NULL,
	"mdr" bigint NOT NULL,
	"net_received" bigint NOT NULL,
	"partner_share" bigint NOT NULL,
	"platform_commission" bigint NOT NULL,
	"pickup_lat" double precision NOT NULL,
	"pickup_lng" double precision NOT NULL,
	"dropoff_lat" double precision NOT NULL,
	"dropoff_lng" double precision NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"order_id" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"account" text NOT NULL,
	"debit" bigint NOT NULL,
	"credit" bigint NOT NULL,
	"subledger" text
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_partner_idx" ON "orders" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "journal_entries_order_idx" ON "journal_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "journal_entries_code_idx" ON "journal_entries" USING btree ("code");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account");--> statement-breakpoint
CREATE INDEX "journal_lines_account_subledger_idx" ON "journal_lines" USING btree ("account","subledger");