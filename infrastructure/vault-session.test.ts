import { describe, expect, test } from "bun:test";

import { backoffMs, createVaultSessions, hashToken } from "./vault-session";

const MINUTE = 60_000;
const IDLE = 15 * MINUTE;

/** A clock the test moves by hand. */
const fakeClock = (start = 1_000_000) => {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
};

const KEY = Buffer.alloc(32, 3);

describe("vault sessions (#142)", () => {
  test("the right token opens; a missing or wrong one does not", () => {
    const clock = fakeClock();
    const sessions = createVaultSessions(clock.now);
    expect(sessions.check("actor-a", "t1", IDLE)).toEqual({ kind: "locked" });
    sessions.open("actor-a", "0123456789abcdef", KEY, "t1");
    const opened = sessions.check("actor-a", "t1", IDLE);
    expect(opened.kind).toBe("unlocked");
    if (opened.kind === "unlocked") {
      expect(opened.keys.keyId).toBe("0123456789abcdef");
      expect(opened.keys.dataKey.export().toString("hex")).toBe(KEY.toString("hex"));
    }
    expect(sessions.check("actor-a", null, IDLE)).toEqual({ kind: "wrong-token" });
    expect(sessions.check("actor-a", "t2", IDLE)).toEqual({ kind: "wrong-token" });
    expect(sessions.check("actor-b", "t1", IDLE)).toEqual({ kind: "locked" });
  });

  test("the session keeps its own copy of the key", () => {
    const sessions = createVaultSessions(fakeClock().now);
    const key = Buffer.alloc(32, 4);
    sessions.open("actor-a", "0123456789abcdef", key, "t1");
    key.fill(0);
    const opened = sessions.check("actor-a", "t1", IDLE);
    expect(
      opened.kind === "unlocked" ? opened.keys.dataKey.export().toString("hex") : null,
    ).toBe("04".repeat(32));
  });

  test("idle for the idle time locks on the next check; use keeps it open", () => {
    const clock = fakeClock();
    const sessions = createVaultSessions(clock.now);
    sessions.open("actor-a", "0123456789abcdef", KEY, "t1");
    clock.advance(IDLE - 1);
    expect(sessions.check("actor-a", "t1", IDLE).kind).toBe("unlocked");
    clock.advance(IDLE - 1);
    expect(sessions.check("actor-a", "t1", IDLE).kind).toBe("unlocked");
    clock.advance(IDLE);
    expect(sessions.check("actor-a", "t1", IDLE)).toEqual({ kind: "idle-locked" });
    expect(sessions.check("actor-a", "t1", IDLE)).toEqual({ kind: "locked" });
  });

  test("holds and isOpen look without counting as use", () => {
    const clock = fakeClock();
    const sessions = createVaultSessions(clock.now);
    sessions.open("actor-a", "0123456789abcdef", KEY, "t1");
    clock.advance(IDLE - 1);
    expect(sessions.holds("actor-a", "t1", IDLE)).toBe(true);
    expect(sessions.holds("actor-a", "t2", IDLE)).toBe(false);
    expect(sessions.isOpen("actor-a", IDLE)).toBe(true);
    clock.advance(1);
    expect(sessions.holds("actor-a", "t1", IDLE)).toBe(false);
    expect(sessions.isOpen("actor-a", IDLE)).toBe(false);
  });

  test("the sweep locks only the idle sessions and names them", () => {
    const clock = fakeClock();
    const sessions = createVaultSessions(clock.now);
    sessions.open("actor-a", "0123456789abcdef", KEY, "t1");
    clock.advance(10 * MINUTE);
    sessions.open("actor-b", "0123456789abcdef", KEY, "t2");
    clock.advance(5 * MINUTE);
    expect(sessions.sweep(IDLE)).toEqual(["actor-a"]);
    expect(sessions.check("actor-a", "t1", IDLE)).toEqual({ kind: "locked" });
    expect(sessions.check("actor-b", "t2", IDLE).kind).toBe("unlocked");
    expect(sessions.sweep(IDLE)).toEqual([]);
  });

  test("lock ends the session at once", () => {
    const sessions = createVaultSessions(fakeClock().now);
    sessions.open("actor-a", "0123456789abcdef", KEY, "t1");
    expect(sessions.lock("actor-a")).toBe(true);
    expect(sessions.lock("actor-a")).toBe(false);
    expect(sessions.check("actor-a", "t1", IDLE)).toEqual({ kind: "locked" });
  });

  test("only the token's hash is kept", () => {
    expect(hashToken("abc").toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("failed attempts (#142)", () => {
  test("the wait doubles from 1 s to at most 60 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([
      0, 1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000,
    ]);
  });

  test("each wrong attempt sets the wait; success clears it; actors are separate", () => {
    const clock = fakeClock();
    const sessions = createVaultSessions(clock.now);
    expect(sessions.retryAfterMs("actor-a")).toBe(0);
    expect(sessions.noteFailure("actor-a")).toBe(1);
    expect(sessions.retryAfterMs("actor-a")).toBe(1000);
    clock.advance(1000);
    expect(sessions.retryAfterMs("actor-a")).toBe(0);
    expect(sessions.noteFailure("actor-a")).toBe(2);
    expect(sessions.retryAfterMs("actor-a")).toBe(2000);
    expect(sessions.retryAfterMs("actor-b")).toBe(0);
    sessions.clearFailures("actor-a");
    expect(sessions.retryAfterMs("actor-a")).toBe(0);
    expect(sessions.noteFailure("actor-a")).toBe(1);
  });

  test("a count is forgotten an hour after the last wrong attempt", () => {
    const clock = fakeClock();
    const sessions = createVaultSessions(clock.now);
    sessions.noteFailure("actor-a");
    sessions.noteFailure("actor-a");
    clock.advance(60 * MINUTE);
    expect(sessions.noteFailure("actor-a")).toBe(1);
  });
});

describe("keys for the stores (#141)", () => {
  test("keysOf gives the keys while open and not idle, without counting as use", () => {
    const clock = fakeClock();
    const sessions = createVaultSessions(clock.now);
    expect(sessions.keysOf("actor-a", IDLE)).toBeNull();
    sessions.open("actor-a", "0123456789abcdef", KEY, "t1", [
      { keyId: "fedcba9876543210", dataKey: Buffer.alloc(32, 4) },
    ]);
    const keys = sessions.keysOf("actor-a", IDLE);
    expect(keys?.keyId).toBe("0123456789abcdef");
    expect(keys?.retiring.map((key) => key.keyId)).toEqual(["fedcba9876543210"]);
    expect(sessions.keysOf("actor-b", IDLE)).toBeNull();
    clock.advance(IDLE);
    expect(sessions.keysOf("actor-a", IDLE)).toBeNull();
  });
});
