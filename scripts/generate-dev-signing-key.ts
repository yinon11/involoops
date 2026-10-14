/**
 * Bootstrap or rotate the document signing key (Spec 04).
 *
 * The environment is required. There is no default, so a dev key cannot
 * be minted into production just by running the script.
 *
 *   npx tsx scripts/generate-dev-signing-key.ts --env dev
 *   npx tsx scripts/generate-dev-signing-key.ts --env production \
 *     --private-key-out /etc/involoops/signing-private-key.pem
 *   npx tsx scripts/generate-dev-signing-key.ts --env sandbox \
 *     --private-key-out /etc/involoops/signing-private-key-sandbox.pem
 *
 * `--env dev` inserts `involoops-dev-…` / `CN=InvoLoops Dev, …` and
 * refuses any database host that is not localhost.
 * `--env production` inserts `involoops-prod-…` / `CN=InvoLoops, …`,
 * writes the private key to `--private-key-out` (mode 600), and does
 * not print the PEM. It refuses the sandbox database.
 * `--env sandbox` inserts `involoops-sandbox-…` /
 * `CN=InvoLoops Sandbox, …` into a database named `invoices_sandbox`
 * only, writes the private key to its own file, and does not print it.
 *
 * Each run retires the current ACTIVE row and inserts a new one. The
 * retired public key stays in `signing_keys` so already-issued documents
 * keep verifying. The private key is never written except to the path
 * you pass for production.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import postgres from "postgres";

type SigningEnv = "dev" | "production" | "sandbox";

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}

function parseArgs(argv: string[]): {
  env: SigningEnv;
  privateKeyOut?: string;
} {
  let env: string | undefined;
  let privateKeyOut: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env") {
      env = argv[++i];
    } else if (arg.startsWith("--env=")) {
      env = arg.slice("--env=".length);
    } else if (arg === "--private-key-out") {
      privateKeyOut = argv[++i];
    } else if (arg.startsWith("--private-key-out=")) {
      privateKeyOut = arg.slice("--private-key-out=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (env !== "dev" && env !== "production" && env !== "sandbox") {
    throw new Error(
      "Pass --env dev, --env production, or --env sandbox. There is no default, so a dev key cannot be minted by accident.",
    );
  }
  if ((env === "production" || env === "sandbox") && !privateKeyOut) {
    throw new Error(
      `--env ${env} requires --private-key-out <absolute path>. The private key is written there and is not printed.`,
    );
  }
  if (privateKeyOut && !privateKeyOut.startsWith("/")) {
    throw new Error("--private-key-out must be an absolute path.");
  }
  return { env, privateKeyOut };
}

function databaseHost(databaseUrl: string): string {
  return new URL(databaseUrl.replace(/^postgres(ql)?:/, "http:")).hostname;
}

function databaseName(databaseUrl: string): string {
  const pathname = new URL(databaseUrl.replace(/^postgres(ql)?:/, "http:")).pathname;
  return decodeURIComponent(pathname.replace(/^\//, "").split("/")[0] ?? "");
}

function assertDevDatabaseIsLocal(databaseUrl: string) {
  const host = databaseHost(databaseUrl);
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local) {
    throw new Error(
      `Refusing to mint a dev key against database host "${host}". Use --env production to mint a production key.`,
    );
  }
}

/**
 * Verify we may write the private key to `path` BEFORE any database row is
 * touched.
 *
 * install.sh pre-creates the mounted key file (empty, mode 600) because the
 * Docker bind mount needs it to exist — mounting a missing file makes Docker
 * create a DIRECTORY there instead. An exclusive create therefore cannot
 * succeed on that path, so a 0-byte file counts as "nothing there". A file
 * with actual bytes in it is a real key and is never clobbered.
 */
function assertPrivateKeyDestinationWritable(path: string): void {
  let existing;
  try {
    existing = statSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (!existing.isFile()) {
    throw new Error(`${path} exists and is not a regular file — refusing to write the private key there.`);
  }
  if (existing.size > 0) {
    throw new Error(
      `Refusing to overwrite ${path}: it already holds ${existing.size} bytes, ` +
        "which looks like a signing key in use. Move it aside first if you really mean to rotate.",
    );
  }
}

async function main() {
  const { env, privateKeyOut } = parseArgs(process.argv.slice(2));
  loadEnvFile();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  if (env === "dev") assertDevDatabaseIsLocal(databaseUrl);
  const dbName = databaseName(databaseUrl);
  if (env === "sandbox" && dbName !== "invoices_sandbox") {
    throw new Error(
      `Refusing to mint a sandbox key against database "${dbName || "(none)"}". The database name must be invoices_sandbox.`,
    );
  }
  if (env === "production" && dbName === "invoices_sandbox") {
    throw new Error(
      "Refusing to mint a production key into the sandbox database.",
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const suffix = Math.random().toString(36).slice(2, 8);
  const keyId =
    env === "production"
      ? `involoops-prod-${today}-${suffix}`
      : env === "sandbox"
        ? `involoops-sandbox-${today}-${suffix}`
        : `involoops-dev-${today}-${suffix}`;
  const subject =
    env === "production"
      ? "CN=InvoLoops, O=TTP GO LTD, C=IL"
      : env === "sandbox"
        ? "CN=InvoLoops Sandbox, O=TTP GO LTD, C=IL"
        : "CN=InvoLoops Dev, O=TTP GO LTD, C=IL";

  if (env === "production") {
    if (!keyId.startsWith("involoops-prod-") || subject !== "CN=InvoLoops, O=TTP GO LTD, C=IL") {
      throw new Error("Refusing to insert a non-production identity as the production key.");
    }
  } else if (env === "sandbox") {
    if (!keyId.startsWith("involoops-sandbox-") || !subject.includes("Sandbox")) {
      throw new Error("Refusing to insert a production identity as the sandbox key.");
    }
  } else if (!keyId.startsWith("involoops-dev-") || !subject.includes("Dev")) {
    throw new Error("Refusing to insert a production identity as the dev key.");
  }

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const now = new Date();
  const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  // The private key is the half that cannot be regenerated from the database,
  // so it goes to disk FIRST and the row is written only once it is safely
  // there. The other order leaves an ACTIVE key whose private half does not
  // exist — unrecoverable, and it has already retired the key that worked.
  const writesPrivateKey = env === "production" || env === "sandbox";
  if (writesPrivateKey) {
    assertPrivateKeyDestinationWritable(privateKeyOut!);
    writeFileSync(privateKeyOut!, privateKey, { mode: 0o600, flag: "w" });
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // One transaction: retiring the old key and inserting the new one either
    // both happen or neither does, so there is no window with no ACTIVE key.
    await sql.begin(async (tx) => {
      await tx`UPDATE signing_keys SET status = 'RETIRED', updated_at = NOW() WHERE status = 'ACTIVE'`;
      await tx`
        INSERT INTO signing_keys (
          key_id, algorithm, public_key_pem, subject,
          not_before, not_after, status
        ) VALUES (
          ${keyId},
          'RS256',
          ${publicKey},
          ${subject},
          ${now},
          ${notAfter},
          'ACTIVE'
        )
      `;
    });
  } catch (err) {
    // Truncate rather than unlink: the bind mount needs the file to stay put,
    // and an empty file is exactly the placeholder install.sh starts from.
    if (writesPrivateKey) {
      try {
        writeFileSync(privateKeyOut!, "", { mode: 0o600, flag: "w" });
      } catch {
        console.error(
          `WARNING: could not clear ${privateKeyOut} after the database step failed. ` +
            "Delete its contents before retrying.",
        );
      }
    }
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log("");
  console.log("=".repeat(72));
  console.log(` ${env} signing key generated.`);
  console.log("=".repeat(72));
  console.log("");
  console.log(` key id:  ${keyId}`);
  console.log(` subject: ${subject}`);
  console.log(" Public-key metadata inserted into `signing_keys` as ACTIVE.");
  console.log(" Any previous ACTIVE row has been demoted to RETIRED.");
  console.log("");

  if (writesPrivateKey) {
    console.log(` Private key written to ${privateKeyOut} (mode 600).`);
    console.log(" It was not printed. Point this environment at it with:");
    console.log("");
    console.log(`SIGNING_KEY_ID="${keyId}"`);
    console.log(`SIGNING_PRIVATE_KEY_FILE="${privateKeyOut}"`);
    console.log("");
    if (env === "production") {
      console.log(" Do not put the PEM in .env. Restart the app after mounting the file.");
      console.log(" Add this key id to /etc/involoops/production-signing-key-ids so sandbox boot keeps rejecting it.");
    } else {
      console.log(" Do not put the PEM in .env.sandbox. Do not point sandbox at the production key file.");
      console.log(" Set SIGNING_ENVIRONMENT=sandbox and restart after mounting this file only.");
    }
    return;
  }

  const privateEscaped = privateKey.replace(/\n/g, "\\n");
  console.log(" Paste the following two lines into the dev `.env`:");
  console.log("");
  console.log(`SIGNING_KEY_ID="${keyId}"`);
  console.log(`SIGNING_PRIVATE_KEY_PEM="${privateEscaped}"`);
  console.log("");
  console.log(" Restart the dev server after pasting.");
  console.log("");
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[generate-dev-signing-key] ${message}`);
  process.exit(1);
});
