import { describe, expect, test } from "bun:test";

import { type VaultRead, type VaultRecord } from "@/infrastructure/vault-file";
import { createVaultSessions } from "@/infrastructure/vault-session";

import { VAULT_COPY } from "./vault-copy";
import { clearedUnlockCookie, createVaultHandlers, unlockCookie } from "./vault-handlers";

const ACTOR = "actor-synthetic";
const PASSPHRASE = "synthetic passphrase one";

const harness = (mode: "synthetic" | "personal" = "personal") => {
  let stored: VaultRecord | null = null;
  let tokens = 0;
  const rows: string[] = [];
  const logged: string[] = [];
  const sessions = createVaultSessions(() => 1_000_000);
  const handlers = createVaultHandlers({
    dataMode: () => mode,
    actorId: async () => ACTOR,
    service: () => ({
      read: async (): Promise<VaultRead> =>
        stored === null ? { kind: "missing" } : { kind: "found", record: stored },
      write: async (_actor, record) => {
        stored = record;
      },
      sessions,
      audit: async (_actor, event) => {
        rows.push(event);
      },
      now: () => new Date(1_000_000),
      argon2: true,
      newToken: () => `token-${++tokens}`,
    }),
    sessions: () => sessions,
    idleMs: () => 15 * 60_000,
    setupState: async () => (stored === null ? "not-set-up" : "set-up"),
    onIdleLock: async () => undefined,
    logError: (message, name) => {
      logged.push(`${message} ${name}`);
    },
  });
  return { handlers, rows, logged, sessions };
};

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://localhost:3000/api/vault/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `twinllm_unlock=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });

const statusOf = async (
  handlers: ReturnType<typeof harness>["handlers"],
  cookie?: string,
) =>
  (
    await handlers.status(
      new Request("http://localhost:3000/api/vault/status", {
        headers: cookie ? { cookie: `twinllm_unlock=${cookie}` } : {},
      }),
    )
  ).json();

describe("vault routes (#142)", () => {
  test("the unlock cookie: HttpOnly, SameSite=Strict, Secure only over https", () => {
    expect(unlockCookie("abc", false)).toBe(
      "twinllm_unlock=abc; Path=/; HttpOnly; SameSite=Strict",
    );
    expect(unlockCookie("abc", true)).toBe(
      "twinllm_unlock=abc; Path=/; HttpOnly; SameSite=Strict; Secure",
    );
    expect(clearedUnlockCookie(false)).toBe(
      "twinllm_unlock=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    );
  });

  test("setup, status, lock and unlock, through the routes", async () => {
    const { handlers, rows } = harness();
    expect(await statusOf(handlers)).toEqual({ status: "not-set-up" });

    const setup = await handlers.setup(post("setup", { passphrase: PASSPHRASE }));
    expect(setup.status).toBe(200);
    expect(setup.headers.get("set-cookie")).toBe(unlockCookie("token-1", false));
    expect(setup.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await setup.json();
    expect(Object.keys(body as object)).toEqual(["recoveryCode"]);
    expect(await statusOf(handlers, "token-1")).toEqual({ status: "unlocked" });
    expect(await statusOf(handlers)).toEqual({ status: "locked" });

    // Without the cookie nothing is locked; with it, the vault locks.
    await handlers.lock(post("lock", {}));
    expect(await statusOf(handlers, "token-1")).toEqual({ status: "unlocked" });
    const lock = await handlers.lock(post("lock", {}, "token-1"));
    expect(lock.headers.get("set-cookie")).toBe(clearedUnlockCookie(false));
    expect(await statusOf(handlers, "token-1")).toEqual({ status: "locked" });

    const unlock = await handlers.unlock(post("unlock", { passphrase: PASSPHRASE }));
    expect([unlock.status, await unlock.json()]).toEqual([200, { status: "unlocked" }]);
    expect(unlock.headers.get("set-cookie")).toBe(unlockCookie("token-2", false));
    expect(rows).toEqual(["setup", "lockManual", "unlock"]);
  });

  test("a wrong passphrase: 401, then 429 with Retry-After", async () => {
    const { handlers } = harness();
    await handlers.setup(post("setup", { passphrase: PASSPHRASE }));
    const wrong = await handlers.unlock(
      post("unlock", { passphrase: "synthetic wrong one" }),
    );
    expect([wrong.status, await wrong.json()]).toEqual([
      401,
      { error: VAULT_COPY.wrongPassphrase },
    ]);
    expect(wrong.headers.get("set-cookie")).toBe(null);
    const soon = await handlers.unlock(post("unlock", { passphrase: PASSPHRASE }));
    expect([soon.status, soon.headers.get("retry-after")]).toEqual([429, "1"]);
  });

  test("a malformed body is a plain 400; synthetic mode has no vault", async () => {
    const { handlers } = harness();
    const bad = await handlers.unlock(post("unlock", { pass: 1 }));
    expect([bad.status, await bad.json()]).toEqual([
      400,
      { error: VAULT_COPY.badRequest },
    ]);
    const synthetic = harness("synthetic").handlers;
    expect(await statusOf(synthetic)).toEqual({ status: "synthetic" });
    const refused = await synthetic.setup(post("setup", { passphrase: PASSPHRASE }));
    expect([refused.status, await refused.json()]).toEqual([
      404,
      { error: VAULT_COPY.syntheticMode },
    ]);
  });

  test("recovery through the route returns a new code and sets the cookie", async () => {
    const { handlers } = harness();
    const setup = await handlers.setup(post("setup", { passphrase: PASSPHRASE }));
    const { recoveryCode } = (await setup.json()) as { recoveryCode: string };
    const recovered = await handlers.recover(
      post("recover", { code: recoveryCode, passphrase: "synthetic passphrase two" }),
    );
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("set-cookie")).toBe(unlockCookie("token-2", false));
    const next = (await recovered.json()) as { recoveryCode: string };
    expect(next.recoveryCode).not.toBe(recoveryCode);
  });
});
