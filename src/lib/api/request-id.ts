import { randomBytes } from "node:crypto";

/**
 * Lightweight ULID-ish id (Crockford base32, time-prefixed). Good enough for
 * log correlation; we don't need strict ULID monotonicity here.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

export function newRequestId(): string {
  const t = Date.now();
  const tBytes = new Uint8Array(6);
  for (let i = 5; i >= 0; i--) {
    tBytes[i] = t >>> ((5 - i) * 8) & 0xff; // wrong endianness for very large t but irrelevant for log ids
  }
  // Use big-endian for the time half so ids sort lexically by time.
  const beTime = new Uint8Array(6);
  let v = t;
  for (let i = 5; i >= 0; i--) {
    beTime[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  const rand = randomBytes(10);
  return base32(beTime) + base32(rand);
}

export function readOrCreateRequestId(req: Request): string {
  const provided = req.headers.get("x-request-id");
  if (provided && /^[A-Za-z0-9_-]{8,128}$/.test(provided)) return provided;
  return newRequestId();
}
