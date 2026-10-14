import assert from "node:assert/strict";
import test from "node:test";
import { generateJwks, oauthJwksBootError, parseJwks } from "./jwks.ts";

test("jwks: generated keyset round-trips and oidc-provider accepts it without its dev key", async () => {
  const generated = generateJwks();
  assert.equal(generated.keys.length, 1);
  assert.equal(generated.keys[0].kty, "RSA");
  assert.equal(generated.keys[0].alg, "RS256");
  assert.ok(generated.keys[0].kid.length > 20);
  assert.notEqual(generated.keys[0].kid, "keystore-CHANGE-ME");
  const parsed = parseJwks(JSON.stringify(generated));
  assert.equal(parsed.keys[0].kid, generated.keys[0].kid);

  const { Provider } = await import("oidc-provider");
  const instance = new Provider("https://test.local", { clients: [], jwks: parsed });
  const published = (await (instance as unknown as { jwks?: unknown }).jwks) ?? null;
  assert.ok(instance);
  assert.ok(published === null || JSON.stringify(published).includes(generated.keys[0].kid));
});

test("jwks: malformed values and the published development key are refused", () => {
  assert.throws(() => parseJwks("not json"), /not valid JSON/);
  assert.throws(() => parseJwks("{}"), /at least one key/);
  assert.throws(() => parseJwks(JSON.stringify({ keys: [{ kty: "oct", k: "x", kid: "a" }] })), /unsupported kty/);
  const pub = { ...generateJwks().keys[0] } as Record<string, unknown>;
  delete pub.d;
  delete pub.p;
  delete pub.q;
  delete pub.dp;
  delete pub.dq;
  delete pub.qi;
  assert.throws(() => parseJwks(JSON.stringify({ keys: [pub] })), /PRIVATE key/);
  const noKid = { ...generateJwks().keys[0] } as Record<string, unknown>;
  delete noKid.kid;
  assert.throws(() => parseJwks(JSON.stringify({ keys: [noKid] })), /needs a kid/);
  const badUse = { ...generateJwks().keys[0], use: "enc" };
  assert.throws(() => parseJwks(JSON.stringify({ keys: [badUse] })), /expected sig/);
  const devKid = { ...generateJwks().keys[0], kid: "keystore-CHANGE-ME" };
  assert.throws(() => parseJwks(JSON.stringify({ keys: [devKid] })), /keystore-CHANGE-ME/);
});

test("jwks: boot stays quiet when OAuth is off and refuses a dev key when it is on", () => {
  const saved = { ...process.env };
  try {
    delete process.env.ANTHROPIC_MCP_CLIENT_SECRET;
    delete process.env.OAUTH_JWKS;
    assert.equal(oauthJwksBootError(), null);

    process.env.AUTH_URL = "https://involoops.com";
    process.env.AUTH_SECRET = "s".repeat(32);
    process.env.ANTHROPIC_MCP_CLIENT_ID = "involoops-claude";
    process.env.ANTHROPIC_MCP_CLIENT_SECRET = "c".repeat(32);
    delete process.env.OAUTH_JWKS;
    assert.match(oauthJwksBootError() ?? "", /OAUTH_JWKS is not set/);

    const devKid = { ...generateJwks().keys[0], kid: "keystore-CHANGE-ME" };
    process.env.OAUTH_JWKS = JSON.stringify({ keys: [devKid] });
    assert.match(oauthJwksBootError() ?? "", /keystore-CHANGE-ME/);

    process.env.OAUTH_JWKS = JSON.stringify(generateJwks());
    assert.equal(oauthJwksBootError(), null);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
