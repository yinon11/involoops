import { generateJwks } from "./jwks";

// Prints one JWK Set on a single line. Store the output as OAUTH_JWKS; never commit it.
process.stdout.write(JSON.stringify(generateJwks()) + "\n");
