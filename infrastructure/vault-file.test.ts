import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseVaultRecord,
  readVaultRecord,
  serializeVaultRecord,
  type VaultRecord,
  vaultFilePath,
  vaultUserKey,
  writeVaultRecord,
} from "./vault-file";

const dir = mkdtempSync(join(tmpdir(), "twinllm-vault-file-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const wrapped = {
  kdf: {
    name: "argon2id",
    memoryKiB: 65_536,
    passes: 3,
    parallelism: 1,
    salt: "AgICAgICAgICAgICAgICAg",
  },
  iv: "AQEBAQEBAQEBAQEB",
  data: "c3ludGhldGlj",
} as const;

const RECORD: VaultRecord = {
  v: 1,
  userKey: vaultUserKey("actor-synthetic"),
  keyId: "0123456789abcdef",
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
  passphrase: wrapped,
  recovery: {
    ...wrapped,
    kdf: { name: "scrypt", N: 131_072, r: 8, p: 1, salt: "AgICAgICAgICAgICAgICAg" },
  },
};

describe("the vault file (#142)", () => {
  test("the file name is a hash of the actor, never the actor id", () => {
    expect(vaultUserKey("actor-synthetic")).toMatch(/^[0-9a-f]{32}$/);
    expect(vaultFilePath("/state", "actor-synthetic")).toBe(
      `/state/vault/${vaultUserKey("actor-synthetic")}.json`,
    );
    expect(vaultFilePath("/state", "actor-synthetic")).not.toContain("actor");
  });

  test("KDF parameters and salts survive a round trip", () => {
    expect(parseVaultRecord(serializeVaultRecord(RECORD))).toEqual(RECORD);
  });

  test("anything else is not a record", () => {
    expect(parseVaultRecord("not json")).toBe(null);
    expect(parseVaultRecord(JSON.stringify({ ...RECORD, v: 2 }))).toBe(null);
    expect(
      parseVaultRecord(
        JSON.stringify({ ...RECORD, passphrase: { ...wrapped, kdf: { name: "md5" } } }),
      ),
    ).toBe(null);
  });

  test("written owner-only, read back, and a missing or broken file says so", async () => {
    expect(await readVaultRecord(dir, "actor-synthetic")).toEqual({ kind: "missing" });
    await writeVaultRecord(dir, "actor-synthetic", RECORD);
    expect(await readVaultRecord(dir, "actor-synthetic")).toEqual({
      kind: "found",
      record: RECORD,
    });
    expect(statSync(join(dir, "vault")).mode & 0o777).toBe(0o700);
    expect(statSync(vaultFilePath(dir, "actor-synthetic")).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dir, "vault"))).toEqual([
      `${vaultUserKey("actor-synthetic")}.json`,
    ]);
    writeFileSync(vaultFilePath(dir, "actor-broken"), "{", { mode: 0o600 });
    expect(await readVaultRecord(dir, "actor-broken")).toEqual({ kind: "unreadable" });
  });
});
