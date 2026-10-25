#!/usr/bin/env bun
/**
 * Prints Google Health local OAuth setup status and the exact Console steps.
 * Does not create credentials — Google requires your Cloud project.
 *
 * Usage: bun scripts/google-health-setup.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const envPath = resolve(root, ".env.local");

const loadEnv = () => {
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const env = loadEnv();
const clientId = env.GOOGLE_HEALTH_CLIENT_ID?.trim();
const clientSecret = env.GOOGLE_HEALTH_CLIENT_SECRET?.trim();
const redirect =
  env.GOOGLE_HEALTH_REDIRECT_URI?.trim() ||
  "http://localhost:3000/api/google-health/callback";
const encryptionKey = env.GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY?.trim();

const ok = (label, pass) => console.log(`${pass ? "✓" : "✗"} ${label}`);

console.log("\nGoogle Health — local TwinLLM setup\n");
ok("GOOGLE_HEALTH_CLIENT_ID set", Boolean(clientId));
ok("GOOGLE_HEALTH_CLIENT_SECRET set", Boolean(clientSecret));
ok("GOOGLE_HEALTH_REDIRECT_URI set", Boolean(redirect));
ok(
  "GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY set (64 hex)",
  Boolean(encryptionKey && /^[0-9a-fA-F]{64}$/.test(encryptionKey)),
);

console.log(`\nRedirect URI (must match OAuth client exactly):\n  ${redirect}\n`);

console.log("Console steps:");
console.log("  1. Open https://developers.google.com/health/setup");
console.log('  2. Use "Enable the API and get an OAuth 2.0 Client ID"');
console.log('  3. Calling from: "Web Server"');
console.log(`  4. Authorized redirect URI: ${redirect}`);
console.log("     (replace the default https://www.google.com if the wizard set that)");
console.log("  5. OAuth consent → add Google Health API scopes (readonly)");
console.log("  6. Add your Google account as a Test user (if app is in Testing)");
console.log("  7. Paste Client ID + Secret into twin-llm/.env.local");
console.log("  8. Restart: bunx next dev");
console.log("  9. Open http://localhost:3000/connectors → Link Google Health\n");

console.log("Requirements for data:");
console.log("  • Google account linked to Fitbit (Health Connect alone is not enough)");
console.log("  • Project entitled for Google Health API (private preview may apply)\n");

if (clientId && clientSecret && encryptionKey) {
  console.log("Env looks complete. Restart Next if it was already running, then Link.\n");
  process.exit(0);
}

console.log(
  "Missing Client ID/Secret — create them in Google Cloud, then paste into .env.local.\n",
);
process.exit(1);
