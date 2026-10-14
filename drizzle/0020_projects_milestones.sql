-- Projects + Milestone Billing feature.
--
-- projects       — a deal / engagement with a customer, has a total value.
-- project_milestones — billing checkpoints inside a project; each can be
--                      linked to an outbound invoice once issued.

CREATE TABLE IF NOT EXISTS "projects" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "customer_id"  uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "name"         text NOT NULL,
  "total_amount" numeric(12, 2) NOT NULL,
  "currency"     text NOT NULL DEFAULT 'ILS',
  "status"       text NOT NULL DEFAULT 'active',  -- active | completed | cancelled
  "start_date"   date,
  "notes"        text,
  "created_at"   timestamptz DEFAULT now(),
  "updated_at"   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");
CREATE INDEX IF NOT EXISTS "projects_customer_id_idx" ON "projects" ("customer_id");

CREATE TABLE IF NOT EXISTS "project_milestones" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id"           uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "title"                text NOT NULL,
  "amount"               numeric(12, 2) NOT NULL,
  "due_date"             date NOT NULL,
  "status"               text NOT NULL DEFAULT 'pending', -- pending | invoiced | paid
  "outbound_invoice_id"  uuid REFERENCES "outbound_invoices"("id") ON DELETE SET NULL,
  "notes"                text,
  "created_at"           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "project_milestones_project_id_idx"
  ON "project_milestones" ("project_id");
CREATE INDEX IF NOT EXISTS "project_milestones_outbound_invoice_id_idx"
  ON "project_milestones" ("outbound_invoice_id");
