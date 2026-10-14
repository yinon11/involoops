import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { apiKeys } from "./api-keys";
import { invoices } from "./invoices";

/**
 * Async upload + extraction queue for the public API. The web-app upload
 * flow still runs inline; this queue only backs the REST surface where
 * high concurrency + webhook notification pays off.
 *
 * State machine:
 *   awaiting_upload  POST /uploads returned a presigned URL but the client
 *                    hasn't called /process yet.
 *   queued           Client confirmed upload; worker hasn't claimed it yet.
 *   processing       Worker claimed the row; locked_until gates re-claim.
 *   done             Extraction finished; invoice_id points at the record.
 *   error            Terminal failure after retries exhausted.
 *
 * See docs/api/06-uploads-and-extraction.md.
 */
export const uploadJobs = pgTable(
  "upload_jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    fileKey: text("file_key").notNull(),
    fileName: varchar("file_name", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Caller-provided hints ({ type?, vendor_id_hint? }). */
    hint: jsonb().notNull().default({}),
    status: varchar({ length: 16 }).notNull().default("awaiting_upload"),
    attempts: integer().notNull().default(0),
    lockedUntil: timestamp("locked_until"),
    invoiceId: uuid("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("upload_jobs_user_idx").on(t.userId, t.createdAt),
  ],
);

export const uploadJobsRelations = relations(uploadJobs, ({ one }) => ({
  user: one(users, { fields: [uploadJobs.userId], references: [users.id] }),
  apiKey: one(apiKeys, {
    fields: [uploadJobs.apiKeyId],
    references: [apiKeys.id],
  }),
  invoice: one(invoices, {
    fields: [uploadJobs.invoiceId],
    references: [invoices.id],
  }),
}));

export type UploadJobStatus =
  | "awaiting_upload"
  | "queued"
  | "processing"
  | "done"
  | "error";

export type UploadJobRow = typeof uploadJobs.$inferSelect;
