/* eslint-disable @typescript-eslint/no-require-imports -- preloaded with `node --require`, so it must be CommonJS. */
// Lets the verify harnesses import modules guarded by `import "server-only"`.
// That package throws outside a React Server Components build by design; a
// harness run under tsx is server code, so it resolves to an empty module.
// Usage: NODE_OPTIONS="--require ./scripts/stub-server-only.cjs" npx tsx scripts/<harness>.ts
const Module = require("module");
const path = require("path");
const empty = path.join(__dirname, "stub-server-only-empty.cjs");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return empty;
  return original.call(this, request, ...rest);
};
