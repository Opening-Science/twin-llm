import { describe, expect, test } from "bun:test";

import { type VaultAuditEvent } from "@/infrastructure/vault-audit";
import { type VaultRead, type VaultRecord } from "@/infrastructure/vault-file";
import { createVaultSessions } from "@/infrastructure/vault-session";

import { VAULT_COPY } from "./vault-copy";
import {
  lockVault,
  openRecord,
  recoverVault,
  sealRecord,
  setUpVault,
  unlockVault,
  type VaultServiceDeps,
} from "./vault-service";

const ACTOR = "actor-synthetic";
const PASSPHRASE = "synthetic passphrase one";
const IDLE = 15 * 60_000;

/** An in-memory key file, a fake clock and a recorded audit trail. */
const harness = (options: Readonly<{ auditFails?: VaultAuditEvent }> = {}) => {
  let at = 1_000_000;
  let stored: VaultRecord | null = null;
  let tokens = 0;
  const rows: string[] = [];
  const sessions = createVaultSessions(() => at);
  const deps: VaultServiceDeps = {
    read: async (): Promise<VaultRead> =>
      stored === null ? { kind: "missing" } : { kind: "found", record: stored },
    write: async (_actor, record) => {
      stored = record;
    },
    sessions,
    audit: async (actor, event, failures = 0) => {
      if (event === options.auditFails) throw new Error("audit down");
      rows.push(`${actor} ${event} ${failures}`);
    },
    now: () => new Date(at),
    argon2: true,
    newToken: () => `token-${++tokens}`,
  };
  return {
    deps,
    sessions,
    rows,
    stored: () => stored,
    advance: (ms: number) => {
      at += ms;
    },
  };
};

const unlocked = (h: ReturnType<typeof harness>, token: string) =>
  h.sessions.check(ACTOR, token, IDLE).kind === "unlocked";

describe("setting up (#142)", () => {
  test("first run stores a wrapped key, opens the vault and returns a code once", async () => {
    const h = harness();
    const result = await setUpVault(h.deps, ACTOR, PASSPHRASE);
    expect(result.kind).toBe("opened");
    if (result.kind !== "opened") return;
    expect(result.recoveryCode).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(unlocked(h, result.token)).toBe(true);
    expect(h.rows).toEqual([`${ACTOR} setup 0`]);
    const text = JSON.stringify(h.stored());
    expect(text).not.toContain(PASSPHRASE);
    expect(text).not.toContain(result.recoveryCode.replace(/-/g, ""));
    expect(h.stored()?.passphrase.kdf.name).toBe("argon2id");
  });

  test("a short passphrase, or a second setup, is refused", async () => {
    const h = harness();
    expect(await setUpVault(h.deps, ACTOR, "too short")).toEqual({
      kind: "refused",
      status: 400,
      message: "Use at least 12 characters.",
    });
    await setUpVault(h.deps, ACTOR, PASSPHRASE);
    expect(await setUpVault(h.deps, ACTOR, "another synthetic one")).toEqual({
      kind: "refused",
      status: 409,
      message: VAULT_COPY.alreadySetUp,
    });
  });

  test("a setup that cannot be recorded stores nothing and opens nothing", async () => {
    const h = harness({ auditFails: "setup" });
    expect(await setUpVault(h.deps, ACTOR, PASSPHRASE)).toEqual({
      kind: "refused",
      status: 503,
      message: VAULT_COPY.setupFailed,
    });
    expect(h.stored()).toBe(null);
    expect(h.sessions.isOpen(ACTOR, IDLE)).toBe(false);
  });
});

describe("unlocking (#142)", () => {
  test("the right passphrase opens with a new token; lock closes it", async () => {
    const h = harness();
    await setUpVault(h.deps, ACTOR, PASSPHRASE);
    h.sessions.lock(ACTOR);
    const result = await unlockVault(h.deps, ACTOR, PASSPHRASE);
    expect(result).toEqual({ kind: "opened", token: "token-2" });
    expect(unlocked(h, "token-2")).toBe(true);
    expect(unlocked(h, "token-1")).toBe(false);
    expect(await lockVault(h.deps, ACTOR)).toBe(true);
    expect(unlocked(h, "token-2")).toBe(false);
    expect(await lockVault(h.deps, ACTOR)).toBe(false);
    expect(h.rows).toEqual([
      `${ACTOR} setup 0`,
      `${ACTOR} unlock 0`,
      `${ACTOR} lockManual 0`,
    ]);
  });

  test("a wrong passphrase is refused, counted, and slows the next try", async () => {
    const h = harness();
    await setUpVault(h.deps, ACTOR, PASSPHRASE);
    h.sessions.lock(ACTOR);
    expect(await unlockVault(h.deps, ACTOR, "synthetic wrong passphrase")).toEqual({
      kind: "refused",
      status: 401,
      message: VAULT_COPY.wrongPassphrase,
    });
    expect(h.sessions.isOpen(ACTOR, IDLE)).toBe(false);
    expect(await unlockVault(h.deps, ACTOR, PASSPHRASE)).toEqual({
      kind: "refused",
      status: 429,
      message: VAULT_COPY.wait(1),
      retryAfterSeconds: 1,
    });
    h.advance(1000);
    expect(await unlockVault(h.deps, ACTOR, "synthetic wrong again")).toMatchObject({
      status: 401,
    });
    h.advance(2000);
    expect(await unlockVault(h.deps, ACTOR, PASSPHRASE)).toMatchObject({
      kind: "opened",
    });
    expect(h.rows).toEqual([
      `${ACTOR} setup 0`,
      `${ACTOR} unlockRefused 1`,
      `${ACTOR} unlockRefused 2`,
      `${ACTOR} unlock 0`,
    ]);
    // Success cleared the count.
    expect(h.sessions.retryAfterMs(ACTOR)).toBe(0);
  });

  test("an unlock that cannot be recorded is undone", async () => {
    const h = harness({ auditFails: "unlock" });
    await setUpVault(h.deps, ACTOR, PASSPHRASE);
    h.sessions.lock(ACTOR);
    expect(await unlockVault(h.deps, ACTOR, PASSPHRASE)).toEqual({
      kind: "refused",
      status: 503,
      message: VAULT_COPY.notRecorded,
    });
    expect(h.sessions.isOpen(ACTOR, IDLE)).toBe(false);
  });

  test("no key file asks for setup; an unreadable one says so", async () => {
    const h = harness();
    expect(await unlockVault(h.deps, ACTOR, PASSPHRASE)).toEqual({
      kind: "refused",
      status: 409,
      message: VAULT_COPY.notSetUp,
    });
    const broken = {
      ...h.deps,
      read: async (): Promise<VaultRead> => ({ kind: "unreadable" }),
    };
    expect(await unlockVault(broken, ACTOR, PASSPHRASE)).toMatchObject({ status: 500 });
  });

  test("one person's passphrase never opens another person's record", async () => {
    const h = harness();
    await setUpVault(h.deps, ACTOR, PASSPHRASE);
    // The other actor reads the first actor's file: its additional data does not match.
    expect(await unlockVault(h.deps, "actor-other", PASSPHRASE)).toMatchObject({
      status: 401,
    });
  });
});

describe("recovery (#142)", () => {
  test("the code sets a new passphrase and a new code; the old ones stop working", async () => {
    const h = harness();
    const first = await setUpVault(h.deps, ACTOR, PASSPHRASE);
    if (first.kind !== "opened") throw new Error("setup failed");
    h.sessions.lock(ACTOR);
    const keyId = h.stored()?.keyId;

    const recovered = await recoverVault(
      h.deps,
      ACTOR,
      first.recoveryCode.toLowerCase(),
      "synthetic passphrase two",
    );
    expect(recovered.kind).toBe("opened");
    if (recovered.kind !== "opened") return;
    expect(recovered.recoveryCode).not.toBe(first.recoveryCode);
    expect(unlocked(h, recovered.token)).toBe(true);
    // The same data key, rewrapped: the key id stays.
    expect(h.stored()?.keyId).toBe(keyId);
    h.sessions.lock(ACTOR);

    expect(await unlockVault(h.deps, ACTOR, PASSPHRASE)).toMatchObject({ status: 401 });
    h.advance(1000);
    expect(await unlockVault(h.deps, ACTOR, "synthetic passphrase two")).toMatchObject({
      kind: "opened",
    });
    h.sessions.lock(ACTOR);
    expect(
      await recoverVault(h.deps, ACTOR, first.recoveryCode, "synthetic passphrase three"),
    ).toMatchObject({ status: 401, message: VAULT_COPY.wrongCode });
    expect(h.rows).toEqual([
      `${ACTOR} setup 0`,
      `${ACTOR} recoveryUsed 0`,
      `${ACTOR} unlockRefused 1`,
      `${ACTOR} unlock 0`,
      `${ACTOR} recoveryRefused 1`,
    ]);
  });

  test("a code of the wrong shape or a short new passphrase is refused before any work", async () => {
    const h = harness();
    await setUpVault(h.deps, ACTOR, PASSPHRASE);
    expect(await recoverVault(h.deps, ACTOR, "ABCD", "synthetic passphrase two")).toEqual(
      {
        kind: "refused",
        status: 400,
        message: VAULT_COPY.codeShape,
      },
    );
    expect(await recoverVault(h.deps, ACTOR, "A".repeat(32), "short")).toMatchObject({
      status: 400,
    });
    expect(h.rows).toEqual([`${ACTOR} setup 0`]);
  });
});

describe("a rotation's retiring key (#141)", () => {
  const ACTIVE = { keyId: "2222222222222222", dataKey: Buffer.alloc(32, 2) };
  const RETIRING = { keyId: "1111111111111111", dataKey: Buffer.alloc(32, 1) };
  const CODE = "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH";

  const rotatingRecord = () =>
    sealRecord({
      actorId: ACTOR,
      keyId: ACTIVE.keyId,
      dek: Buffer.from(ACTIVE.dataKey),
      passphrase: PASSPHRASE,
      recoveryCode: CODE,
      createdAt: new Date(0).toISOString(),
      now: new Date(0),
      argon2: false,
      retiring: [{ keyId: RETIRING.keyId, dataKey: Buffer.from(RETIRING.dataKey) }],
    });

  test("both keys open with the passphrase and with the recovery code", async () => {
    const record = await rotatingRecord();
    expect(record.retiring?.map((key) => key.keyId)).toEqual([RETIRING.keyId]);
    for (const [secret, purpose] of [
      [PASSPHRASE, "passphrase"],
      [CODE.replace(/-/g, ""), "recovery"],
    ] as const) {
      const keys = await openRecord(ACTOR, record, secret, purpose);
      expect(keys?.active.keyId).toBe(ACTIVE.keyId);
      expect(keys?.active.dataKey.equals(ACTIVE.dataKey)).toBe(true);
      expect(keys?.retiring.map((key) => key.dataKey.equals(RETIRING.dataKey))).toEqual([
        true,
      ]);
    }
    expect(
      await openRecord(ACTOR, record, "wrong synthetic passphrase", "passphrase"),
    ).toBeNull();
    expect(await openRecord("someone-else", record, PASSPHRASE, "passphrase")).toBeNull();
  });

  test("unlocking during a rotation puts both keys in the session", async () => {
    const h = harness();
    await h.deps.write(ACTOR, await rotatingRecord());
    const result = await unlockVault(h.deps, ACTOR, PASSPHRASE);
    expect(result.kind).toBe("opened");
    const keys = h.sessions.keysOf(ACTOR, IDLE);
    expect(keys?.keyId).toBe(ACTIVE.keyId);
    expect(keys?.retiring.map((key) => key.keyId)).toEqual([RETIRING.keyId]);
  });

  test("recovery during a rotation keeps the retiring key", async () => {
    const h = harness();
    await h.deps.write(ACTOR, await rotatingRecord());
    const result = await recoverVault(
      h.deps,
      ACTOR,
      CODE,
      "another synthetic passphrase",
    );
    expect(result.kind).toBe("opened");
    expect(h.stored()?.retiring?.map((key) => key.keyId)).toEqual([RETIRING.keyId]);
    expect(h.sessions.keysOf(ACTOR, IDLE)?.retiring).toHaveLength(1);
  });
});
