import { describe, expect, test } from "bun:test";

import {
  checkVault,
  cookieValue,
  createWithUnlocked,
  LOCKED_MESSAGE,
  NOT_SET_UP_MESSAGE,
  type VaultGateDeps,
  type VaultSetupState,
} from "./vault-gate";
import { createVaultSessions } from "./vault-session";

const IDLE = 15 * 60_000;

const setup = (
  overrides: Partial<{
    mode: "synthetic" | "personal";
    actor: string | null;
    state: VaultSetupState;
  }> = {},
) => {
  let at = 0;
  const sessions = createVaultSessions(() => at);
  const idleLocked: string[] = [];
  const deps: VaultGateDeps = {
    dataMode: () => overrides.mode ?? "personal",
    actorId: async () => (overrides.actor === undefined ? "actor-a" : overrides.actor),
    sessions: () => sessions,
    idleMs: () => IDLE,
    setupState: async () => overrides.state ?? "set-up",
    onIdleLock: async (actorId) => {
      idleLocked.push(actorId);
    },
  };
  return {
    deps,
    sessions,
    idleLocked,
    advance: (ms: number) => {
      at += ms;
    },
  };
};

describe("the unlock gate (#142)", () => {
  test("synthetic mode always passes, with no keys", async () => {
    const { deps } = setup({ mode: "synthetic" });
    expect(await checkVault(deps, null)).toEqual({ ok: true, actorId: null, keys: null });
  });

  test("personal mode without a session: 423, set up or unlock", async () => {
    expect(await checkVault(setup().deps, null)).toEqual({
      ok: false,
      status: 423,
      code: "PERSONAL_DATA_LOCKED",
      message: LOCKED_MESSAGE,
    });
    expect(await checkVault(setup({ state: "not-set-up" }).deps, null)).toEqual({
      ok: false,
      status: 423,
      code: "PERSONAL_DATA_NOT_SET_UP",
      message: NOT_SET_UP_MESSAGE,
    });
    expect(await checkVault(setup({ state: "unreadable" }).deps, null)).toMatchObject({
      status: 423,
      code: "PERSONAL_DATA_LOCKED",
    });
  });

  test("no actor is a sign-in refusal", async () => {
    expect(await checkVault(setup({ actor: null }).deps, null)).toEqual({
      ok: false,
      status: 401,
      code: "SIGN_IN",
      message: "Sign in to continue.",
    });
  });

  test("the right cookie passes with the keys; the wrong one does not", async () => {
    const { deps, sessions } = setup();
    sessions.open("actor-a", "0123456789abcdef", Buffer.alloc(32, 1), "right");
    const passed = await checkVault(deps, "right");
    expect(passed.ok && passed.keys?.keyId).toBe("0123456789abcdef");
    expect((await checkVault(deps, "wrong")).ok).toBe(false);
  });

  test("an idle session is locked and recorded once", async () => {
    const { deps, sessions, idleLocked, advance } = setup();
    sessions.open("actor-a", "0123456789abcdef", Buffer.alloc(32, 1), "right");
    advance(IDLE);
    expect(await checkVault(deps, "right")).toMatchObject({ status: 423 });
    expect(await checkVault(deps, "right")).toMatchObject({ status: 423 });
    expect(idleLocked).toEqual(["actor-a"]);
  });

  test("a wrapped handler runs only when unlocked, with its own arguments", async () => {
    const { deps, sessions } = setup();
    const seen: unknown[] = [];
    const handler = createWithUnlocked(() => deps)(async (
      request: Request,
      context: { id: string },
    ) => {
      seen.push([request.method, context.id]);
      return new Response("ok");
    });
    const locked = await handler(new Request("http://localhost/x"), { id: "1" });
    expect([locked.status, await locked.json()]).toEqual([
      423,
      { error: LOCKED_MESSAGE, code: "PERSONAL_DATA_LOCKED" },
    ]);
    expect(locked.headers.get("cache-control")).toBe("no-store");
    sessions.open("actor-a", "0123456789abcdef", Buffer.alloc(32, 1), "right");
    const open = await handler(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { cookie: "theme=dark; twinllm_unlock=right" },
      }),
      { id: "2" },
    );
    expect([open.status, await open.text()]).toEqual([200, "ok"]);
    expect(seen).toEqual([["POST", "2"]]);
  });
});

describe("cookieValue", () => {
  test("finds one cookie by exact name", () => {
    expect(cookieValue("a=1; twinllm_unlock=tok; b=2", "twinllm_unlock")).toBe("tok");
    expect(cookieValue("x_twinllm_unlock=tok", "twinllm_unlock")).toBe(null);
    expect(cookieValue("twinllm_unlock=", "twinllm_unlock")).toBe(null);
    expect(cookieValue(null, "twinllm_unlock")).toBe(null);
  });
});
