/** Subject written by `generate-dev-signing-key.ts --env sandbox`. */
export const SANDBOX_SIGNING_SUBJECT = "CN=InvoLoops Sandbox, O=TTP GO LTD, C=IL";

/** Host path of the production document-signing private key. Sandbox must not use it. */
export const PRODUCTION_SIGNING_KEY_FILE = "/etc/involoops/signing-private-key.pem";

export function readProductionSigningKeyIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    ids.add(trimmed);
  }
  return ids;
}

/**
 * Decide whether this process may boot with the configured signing key.
 * Sandbox must use an `involoops-sandbox-…` id that is not listed among
 * production key ids, and the matching row in this database must be the
 * sandbox subject. Any other environment refuses a sandbox key id.
 * Returns an error message, or null when boot may continue.
 */
export function signingKeyBootError(input: {
  environment: string | undefined;
  keyId: string | undefined;
  privateKeyFile: string | undefined;
  productionKeyIds: ReadonlySet<string>;
  localSubject: string | null;
}): string | null {
  const keyId = input.keyId?.trim() || undefined;
  if (input.environment !== "sandbox") {
    if (keyId?.startsWith("involoops-sandbox-")) {
      return `Refusing to boot: SIGNING_KEY_ID ${keyId} is a sandbox key and cannot sign outside sandbox.`;
    }
    return null;
  }
  if (!keyId) {
    return "Refusing to boot: sandbox SIGNING_KEY_ID is not set.";
  }
  if (!keyId.startsWith("involoops-sandbox-")) {
    return `Refusing to boot: sandbox SIGNING_KEY_ID ${keyId} is not a sandbox key.`;
  }
  if (input.productionKeyIds.has(keyId)) {
    return `Refusing to boot: sandbox SIGNING_KEY_ID ${keyId} exists as a production key.`;
  }
  if (input.privateKeyFile?.trim() === PRODUCTION_SIGNING_KEY_FILE) {
    return "Refusing to boot: sandbox is pointed at the production signing private key file.";
  }
  if (input.localSubject !== SANDBOX_SIGNING_SUBJECT) {
    return `Refusing to boot: sandbox signing key ${keyId} is not present in this database as ${SANDBOX_SIGNING_SUBJECT}.`;
  }
  return null;
}
