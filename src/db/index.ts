import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

/** Avoid hanging forever if Postgres is wedged (helps debug “server stops until Docker restart”). */
export const postgresClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 15,
  max_lifetime: 60 * 30,
  onclose: () => {
    if (process.env.INVOICE_DEBUG_DB === "1") {
      console.log("[postgres] connection closed");
    }
  },
});

export const db = drizzle(postgresClient, { schema });
