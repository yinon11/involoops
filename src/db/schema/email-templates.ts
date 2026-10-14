import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Email content store. Funnel steps reference rows here by id; the renderer
 * looks them up by `code` and `locale` at send time. Adding a new language is
 * an INSERT — one extra row per template per locale — never a migration. When
 * a requested locale row is missing the renderer falls back to `locale="en"`,
 * so partial translations are safe to ship.
 */
export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: varchar({ length: 100 }).notNull(),
    /**
     * BCP 47 short tag (e.g. "en", "he"). Together with `code` forms the
     * natural key — one row per template per language.
     */
    locale: varchar({ length: 8 }).default("en").notNull(),
    name: varchar({ length: 255 }).notNull(),
    subject: varchar({ length: 500 }).notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text"),
    templateType: varchar("template_type", { length: 50 }).default("funnel"),
    /** JSON array of expected variable names, e.g. '["userName","appUrl"]' */
    variables: text(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("email_templates_code_locale_idx").on(table.code, table.locale),
  ],
);
