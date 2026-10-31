import { type VaultKeys, type VaultSessions } from "./vault-session";

/**
 * The one gate in front of every personal read (#142,
 * docs/privacy-design.md 2.2). In personal mode a request passes only when
 * the person's vault is open in this process and the request carries that
 * session's unlock cookie. Otherwise it gets HTTP 423 and a plain sentence.
 * Synthetic installs have no vault and always pass.
 *
 * `checkVault` takes its reads as deps; `createWithUnlocked` wraps a route
 * handler with it. The wiring to the real env, actor and session store is in
 * `vault-runtime.ts`, so tests pass fakes here.
 */

export const VAULT_COOKIE = "twinllm_unlock";

export const PERSONAL_DATA_LOCKED = "PERSONAL_DATA_LOCKED";
export const PERSONAL_DATA_NOT_SET_UP = "PERSONAL_DATA_NOT_SET_UP";

export const LOCKED_MESSAGE = "Your data is locked. Unlock it to continue.";
export const NOT_SET_UP_MESSAGE =
  "Your data is locked until you set a passphrase. Set one to continue.";
export const SIGN_IN_MESSAGE = "Sign in to continue.";

export type VaultSetupState = "set-up" | "not-set-up" | "unreadable";

export type VaultRefusal = Readonly<{
  ok: false;
  status: 401 | 423;
  code: typeof PERSONAL_DATA_LOCKED | typeof PERSONAL_DATA_NOT_SET_UP | "SIGN_IN";
  message: string;
}>;

export type VaultDecision =
  Readonly<{ ok: true; actorId: string | null; keys: VaultKeys | null }> | VaultRefusal;

export type VaultGateDeps = Readonly<{
  dataMode: () => "synthetic" | "personal";
  actorId: () => Promise<string | null>;
  sessions: () => VaultSessions;
  idleMs: () => number;
  /** Read only on the refusal path, to say whether to unlock or to set up. */
  setupState: (actorId: string) => Promise<VaultSetupState>;
  /** Called once when a request finds a session past its idle time (it is locked by then). */
  onIdleLock: (actorId: string) => Promise<void>;
}>;

/** The value of one cookie in a `Cookie` header, or null. */
export const cookieValue = (header: string | null, name: string): string | null => {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
};

const refusal = (setup: VaultSetupState): VaultRefusal =>
  setup === "not-set-up"
    ? {
        ok: false,
        status: 423,
        code: PERSONAL_DATA_NOT_SET_UP,
        message: NOT_SET_UP_MESSAGE,
      }
    : { ok: false, status: 423, code: PERSONAL_DATA_LOCKED, message: LOCKED_MESSAGE };

export const checkVault = async (
  deps: VaultGateDeps,
  token: string | null,
): Promise<VaultDecision> => {
  if (deps.dataMode() !== "personal") return { ok: true, actorId: null, keys: null };
  const actorId = await deps.actorId();
  if (actorId === null) {
    return { ok: false, status: 401, code: "SIGN_IN", message: SIGN_IN_MESSAGE };
  }
  const check = deps.sessions().check(actorId, token, deps.idleMs());
  if (check.kind === "unlocked") return { ok: true, actorId, keys: check.keys };
  if (check.kind === "idle-locked") {
    await deps.onIdleLock(actorId).catch(() => undefined);
  }
  return refusal(await deps.setupState(actorId).catch(() => "unreadable" as const));
};

export const vaultRefusalResponse = (refusal: VaultRefusal): Response =>
  Response.json(
    { error: refusal.message, code: refusal.code },
    { status: refusal.status, headers: { "cache-control": "no-store" } },
  );

/**
 * Wraps a route handler so it runs only behind the gate. The handler's own
 * arguments (the request and the route context) pass through unchanged.
 */
export const createWithUnlocked =
  (deps: () => VaultGateDeps) =>
  <Rest extends unknown[]>(
    handler: (request: Request, ...rest: Rest) => Response | Promise<Response>,
  ) =>
  async (request: Request, ...rest: Rest): Promise<Response> => {
    const decision = await checkVault(
      deps(),
      cookieValue(request.headers.get("cookie"), VAULT_COOKIE),
    );
    return decision.ok ? handler(request, ...rest) : vaultRefusalResponse(decision);
  };
