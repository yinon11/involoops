import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { signingKeys } from "@/db/schema/signing-keys";
import {
  readProductionSigningKeyIds,
  signingKeyBootError,
} from "@/lib/signing/sandbox-guard-rules";

/**
 * Sandbox boot guard. Exits the process when the configured key is a
 * production key, or is not the sandbox key stored in this database.
 * Other environments return immediately unless they were given a sandbox key id.
 */
export async function assertSigningKeyBoot(): Promise<void> {
  const environment = process.env.SIGNING_ENVIRONMENT?.trim();
  const keyId = process.env.SIGNING_KEY_ID?.trim();
  const privateKeyFile = process.env.SIGNING_PRIVATE_KEY_FILE?.trim();

  let productionKeyIds = new Set<string>();
  let localSubject: string | null = null;

  if (environment === "sandbox") {
    const filePath = process.env.SIGNING_PRODUCTION_KEY_IDS_FILE?.trim();
    if (!filePath) {
      console.error(
        "[signing] Refusing to boot: sandbox requires SIGNING_PRODUCTION_KEY_IDS_FILE.",
      );
      process.exit(1);
    }
    try {
      productionKeyIds = readProductionSigningKeyIds(readFileSync(filePath, "utf8"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[signing] Refusing to boot: cannot read production signing key ids at ${filePath}: ${message}`,
      );
      process.exit(1);
    }
    if (productionKeyIds.size === 0) {
      console.error(
        `[signing] Refusing to boot: production signing key id file at ${filePath} is empty.`,
      );
      process.exit(1);
    }
    if (keyId) {
      const [row] = await db
        .select({ subject: signingKeys.subject })
        .from(signingKeys)
        .where(eq(signingKeys.keyId, keyId))
        .limit(1);
      localSubject = row?.subject ?? null;
    }
  }

  const message = signingKeyBootError({
    environment,
    keyId,
    privateKeyFile,
    productionKeyIds,
    localSubject,
  });
  if (message) {
    console.error(`[signing] ${message}`);
    process.exit(1);
  }
}
