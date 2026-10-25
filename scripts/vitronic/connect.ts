/**
 * Host-only CLI. The TwinLLM app never imports this file.
 * TOFU-pins the scanner cert and upserts VitronicConnection for LOCAL_USER_ID.
 * Prints only: connected, fingerprint <12-char prefix>
 *
 * The Connectors page already has a BodyLoop form:
 *   Connectors → BodyLoop card → scanner URL, API token, scan key, upload secret → Save connection → Sync scan
 *
 * Usage (from repo root):
 *   bun --preload ./features/chat/response/preload-server-only.mjs scripts/vitronic/connect.ts
 *
 * Reads VITRONIC_BASE_URL, VITRONIC_API_TOKEN, VITRONIC_PROBAND_ID, LOCAL_USER_ID from .env.local.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintPrefix } from "../../packages/vitronic/tls";

import { loadDotEnvLocal, type MintEnv, type MintIo } from "./mint-token";

export type ConnectPersist = (params: {
  readonly userId: string;
  readonly input: {
    readonly baseUrl: string;
    readonly apiToken: string;
    readonly probandId: number;
  };
}) => Promise<{ readonly tlsFingerprintSha256: string }>;

export type EnsureUser = (clerkId: string) => Promise<{ readonly id: string }>;

export const runConnect = async (
  argv: readonly string[],
  env: MintEnv,
  io: MintIo,
  persist: ConnectPersist,
  ensureUser: EnsureUser,
): Promise<number> => {
  if (argv.includes("--dry-run")) return 0;

  const baseUrl = env.VITRONIC_BASE_URL?.trim();
  const apiToken = env.VITRONIC_API_TOKEN?.trim();
  const rawId = env.VITRONIC_PROBAND_ID?.trim();
  const clerkId = env.LOCAL_USER_ID?.trim() || "local";
  if (!baseUrl || !apiToken || !rawId) {
    io.stderr.write(
      "VITRONIC_BASE_URL, VITRONIC_API_TOKEN, and VITRONIC_PROBAND_ID are required.\n",
    );
    return 1;
  }
  const probandId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(probandId) || probandId < 1) {
    io.stderr.write("VITRONIC_PROBAND_ID must be a positive integer.\n");
    return 1;
  }

  const user = await ensureUser(clerkId);
  const { tlsFingerprintSha256 } = await persist({
    userId: user.id,
    input: { baseUrl, apiToken, probandId },
  });
  io.stdout.write(`connected, fingerprint ${fingerprintPrefix(tlsFingerprintSha256)}\n`);
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const fileEnv = loadDotEnvLocal(root);
  const env: MintEnv = { ...fileEnv, ...process.env };
  const { persistVitronicConnection } =
    await import("../../features/vitronic/connection");
  const { ensureAppUser } = await import("../../infrastructure/current-user");
  const code = await runConnect(
    process.argv.slice(2),
    env,
    process,
    persistVitronicConnection,
    ensureAppUser,
  );
  process.exit(code);
}
