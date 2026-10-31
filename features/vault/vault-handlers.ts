import { z } from "zod";

import { cookieValue, VAULT_COOKIE } from "@/infrastructure/vault-gate";
import { MAX_PASSPHRASE_LENGTH } from "@/infrastructure/vault-crypto";
import { type VaultSessions } from "@/infrastructure/vault-session";

import { VAULT_COPY } from "./vault-copy";
import {
  lockVault,
  recoverVault,
  setUpVault,
  unlockVault,
  type Refused,
  type VaultServiceDeps,
} from "./vault-service";

/**
 * The vault's routes (#142): status, setup, unlock, recover and lock. They
 * answer in personal mode only. A successful setup, unlock or recovery sets
 * the unlock cookie (HttpOnly, SameSite=Strict, Path=/, Secure over https);
 * lock clears it. Bodies are parsed and dropped; a passphrase or code never
 * reaches a log or a response.
 */

export type VaultStatus = "synthetic" | "not-set-up" | "locked" | "unlocked";

export type VaultHandlerDeps = Readonly<{
  dataMode: () => "synthetic" | "personal";
  actorId: () => Promise<string | null>;
  service: () => VaultServiceDeps;
  sessions: () => VaultSessions;
  idleMs: () => number;
  setupState: (actorId: string) => Promise<"set-up" | "not-set-up" | "unreadable">;
  onIdleLock: (actorId: string) => Promise<void>;
  logError: (message: string, name: string) => void;
}>;

const NO_STORE = { "cache-control": "no-store" } as const;

const json = (body: unknown, status = 200, headers: HeadersInit = {}): Response =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

const refusedResponse = (result: Refused): Response =>
  json(
    { error: result.message },
    result.status,
    result.retryAfterSeconds === undefined
      ? {}
      : { "retry-after": String(result.retryAfterSeconds) },
  );

/** The unlock cookie: a session cookie the page's scripts cannot read. */
export const unlockCookie = (token: string, secure: boolean): string =>
  [
    `${VAULT_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");

export const clearedUnlockCookie = (secure: boolean): string =>
  [
    `${VAULT_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");

const isHttps = (request: Request): boolean => new URL(request.url).protocol === "https:";

const passphrase = z
  .string()
  .min(1)
  .max(MAX_PASSPHRASE_LENGTH * 4);
const setupBody = z.object({ passphrase });
const unlockBody = z.object({ passphrase });
const recoverBody = z.object({ code: z.string().min(1).max(200), passphrase });

const readJson = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

type Personal =
  Readonly<{ ok: true; actorId: string }> | Readonly<{ ok: false; response: Response }>;

const personalActor = async (deps: VaultHandlerDeps): Promise<Personal> => {
  if (deps.dataMode() !== "personal") {
    return { ok: false, response: json({ error: VAULT_COPY.syntheticMode }, 404) };
  }
  const actorId = await deps.actorId();
  return actorId === null
    ? { ok: false, response: json({ error: "Sign in to continue." }, 401) }
    : { ok: true, actorId };
};

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

export const createVaultHandlers = (deps: VaultHandlerDeps) => {
  const guarded =
    (label: string, run: (request: Request) => Promise<Response>) =>
    async (request: Request): Promise<Response> => {
      try {
        return await run(request);
      } catch (error) {
        deps.logError(`[vault] ${label} failed`, errorName(error));
        return json({ error: VAULT_COPY.failed }, 500);
      }
    };

  const status = guarded("status", async (request) => {
    if (deps.dataMode() !== "personal") return json({ status: "synthetic" });
    const actorId = await deps.actorId();
    if (actorId === null) return json({ error: "Sign in to continue." }, 401);
    const token = cookieValue(request.headers.get("cookie"), VAULT_COOKIE);
    const check = deps.sessions().check(actorId, token, deps.idleMs());
    if (check.kind === "unlocked") return json({ status: "unlocked" });
    if (check.kind === "idle-locked") await deps.onIdleLock(actorId);
    const setup = await deps.setupState(actorId);
    return json({ status: setup === "not-set-up" ? "not-set-up" : "locked" });
  });

  const opened = (
    request: Request,
    token: string,
    body: Readonly<Record<string, unknown>>,
  ): Response => json(body, 200, { "set-cookie": unlockCookie(token, isHttps(request)) });

  const setup = guarded("setup", async (request) => {
    const who = await personalActor(deps);
    if (!who.ok) return who.response;
    const body = await readJson(request, setupBody);
    if (body === null) return json({ error: VAULT_COPY.badRequest }, 400);
    const result = await setUpVault(deps.service(), who.actorId, body.passphrase);
    return result.kind === "refused"
      ? refusedResponse(result)
      : opened(request, result.token, { recoveryCode: result.recoveryCode });
  });

  const unlock = guarded("unlock", async (request) => {
    const who = await personalActor(deps);
    if (!who.ok) return who.response;
    const body = await readJson(request, unlockBody);
    if (body === null) return json({ error: VAULT_COPY.badRequest }, 400);
    const result = await unlockVault(deps.service(), who.actorId, body.passphrase);
    return result.kind === "refused"
      ? refusedResponse(result)
      : opened(request, result.token, { status: "unlocked" });
  });

  const recover = guarded("recover", async (request) => {
    const who = await personalActor(deps);
    if (!who.ok) return who.response;
    const body = await readJson(request, recoverBody);
    if (body === null) return json({ error: VAULT_COPY.badRequest }, 400);
    const result = await recoverVault(
      deps.service(),
      who.actorId,
      body.code,
      body.passphrase,
    );
    return result.kind === "refused"
      ? refusedResponse(result)
      : opened(request, result.token, { recoveryCode: result.recoveryCode });
  });

  /**
   * Locks the caller's vault. Only the browser holding the unlock cookie can
   * lock, so another user of this machine cannot lock it for them; without a
   * valid cookie there is nothing open for this caller and the answer is the
   * same.
   */
  const lock = guarded("lock", async (request) => {
    const who = await personalActor(deps);
    if (!who.ok) return who.response;
    const token = cookieValue(request.headers.get("cookie"), VAULT_COOKIE);
    const check = deps.sessions().check(who.actorId, token, deps.idleMs());
    if (check.kind === "unlocked") await lockVault(deps.service(), who.actorId);
    if (check.kind === "idle-locked") await deps.onIdleLock(who.actorId);
    return json({ status: "locked" }, 200, {
      "set-cookie": clearedUnlockCookie(isHttps(request)),
    });
  });

  return { status, setup, unlock, recover, lock };
};
