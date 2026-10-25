/**
 * Host-only CLI. The TwinLLM app never imports this file and never stores the
 * BodyLoop password. Mint a per-user API token, then paste the token into
 * POST /api/vitronic/connect. The password grant lives here only.
 *
 * Usage (from repo root):
 *   bun scripts/vitronic/mint-token.ts
 *   bun scripts/vitronic/mint-token.ts --dry-run
 *
 * Reads BODYLOOP_BASE_URL, BODYLOOP_USERNAME, BODYLOOP_PASSWORD from .env.local.
 * Optional: BODYLOOP_TOKEN_NAME, BODYLOOP_TLS_FINGERPRINT.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pinnedRequest, type TlsPinMode } from "../../packages/vitronic/tls";

const TOKEN_TTL_SECONDS = 2_592_000;
const LOGIN_PATH = "/api/v2/authentification/token";

export type MintIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type MintEnv = Readonly<Record<string, string | undefined>>;

export const loadDotEnvLocal = (root: string): Record<string, string> => {
  const envPath = resolve(root, ".env.local");
  if (!existsSync(envPath)) return {};
  const out: Record<string, string> = {};
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

const origin = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const pinModeFromEnv = (fingerprint: string | undefined): TlsPinMode => {
  if (fingerprint && fingerprint.length > 0) {
    return { kind: "pin", fingerprintSha256: fingerprint };
  }
  return { kind: "tofu" };
};

const apiTokenPath = (username: string): string =>
  `/api/v2/authentification/users/${encodeURIComponent(username)}/api_token`;

export const runMint = async (
  argv: readonly string[],
  env: MintEnv,
  io: MintIo,
): Promise<number> => {
  if (argv.includes("--dry-run")) return 0;

  const baseUrl = env.BODYLOOP_BASE_URL?.trim();
  const username = env.BODYLOOP_USERNAME?.trim();
  const password = env.BODYLOOP_PASSWORD;
  if (!baseUrl || !username || !password) {
    io.stderr.write(
      "BODYLOOP_BASE_URL, BODYLOOP_USERNAME, and BODYLOOP_PASSWORD are required.\n",
    );
    return 1;
  }

  const mode = pinModeFromEnv(env.BODYLOOP_TLS_FINGERPRINT?.trim());
  const tokenName = env.BODYLOOP_TOKEN_NAME?.trim() || `twinllm-${Date.now()}`;
  const base = origin(baseUrl);

  const loginBody = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    scope: "admin",
  }).toString();

  const login = await pinnedRequest(
    `${base}${LOGIN_PATH}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: loginBody,
    },
    mode,
  );
  if (login.status < 200 || login.status >= 300) {
    io.stderr.write("BodyLoop login failed.\n");
    return 1;
  }

  let accessToken: string | undefined;
  try {
    const parsed = JSON.parse(login.body.toString("utf8")) as { access_token?: unknown };
    if (typeof parsed.access_token === "string") accessToken = parsed.access_token;
  } catch {
    accessToken = undefined;
  }
  if (!accessToken) {
    io.stderr.write("BodyLoop login did not return a token.\n");
    return 1;
  }

  const minted = await pinnedRequest(
    `${base}${apiTokenPath(username)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        expires_in: TOKEN_TTL_SECONDS,
        apitoken_name: tokenName,
      }),
    },
    mode,
  );
  if (minted.status < 200 || minted.status >= 300) {
    io.stderr.write("BodyLoop API token mint failed.\n");
    return 1;
  }

  let apiToken: string | undefined;
  try {
    const parsed = JSON.parse(minted.body.toString("utf8")) as { access_token?: unknown };
    if (typeof parsed.access_token === "string") apiToken = parsed.access_token;
  } catch {
    apiToken = undefined;
  }
  if (!apiToken) {
    io.stderr.write("BodyLoop API token mint did not return a token.\n");
    return 1;
  }

  io.stdout.write(`${apiToken}\n`);
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const fileEnv = loadDotEnvLocal(root);
  const env: MintEnv = { ...fileEnv, ...process.env };
  const code = await runMint(process.argv.slice(2), env, process);
  process.exit(code);
}
