import { describe, expect, test } from "bun:test";

import {
  ARGON2ID_DEFAULTS,
  argon2Available,
  argon2id,
  deriveKek,
  formatRecoveryCode,
  kdfParamsProblem,
  newKdfParams,
  newRecoveryCode,
  normaliseRecoveryCode,
  passphraseProblem,
  SCRYPT_DEFAULTS,
  scrypt,
  toBase32,
  unwrapKey,
  wrapAad,
  wrapKey,
} from "./vault-crypto";

const hex = (bytes: Buffer) => bytes.toString("hex");
const SALT = Buffer.alloc(16, 2).toString("base64url");

describe("key derivation (#142)", () => {
  test("this runtime has crypto.argon2", () => {
    expect(argon2Available()).toBe(true);
  });

  test("Argon2id matches the RFC 9106 test vector", async () => {
    const tag = await argon2id({
      message: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(16, 2),
      secret: Buffer.alloc(8, 3),
      associatedData: Buffer.alloc(12, 4),
      memoryKiB: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
    });
    expect(hex(tag)).toBe(
      "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
    );
  });

  test("scrypt matches the RFC 7914 test vector", async () => {
    const key = await scrypt(Buffer.from("password"), Buffer.from("NaCl"), {
      N: 1024,
      r: 8,
      p: 16,
      keyLength: 64,
    });
    expect(hex(key)).toBe(
      "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
    );
  });

  test("the default Argon2id parameters give a fixed KEK", async () => {
    const kek = await deriveKek("password", {
      name: "argon2id",
      ...ARGON2ID_DEFAULTS,
      salt: SALT,
    });
    expect(hex(kek)).toBe(
      "fe525ab59ed3b936920e320c0c812a4721c7e8213b4bd4b960c9f15b409c9540",
    );
  });

  test("the passphrase is NFC-normalised, so either spelling of é gives one key", async () => {
    const params = { name: "scrypt", N: 1024, r: 8, p: 1, salt: SALT } as const;
    const composed = await deriveKek("café synthetic", params);
    const decomposed = await deriveKek("café synthetic", params);
    expect(hex(decomposed)).toBe(hex(composed));
  });

  test("new parameters: Argon2id when available, scrypt otherwise, 16-byte salt", () => {
    const salt = Buffer.alloc(16, 7);
    expect(newKdfParams({ argon2: true, salt })).toEqual({
      name: "argon2id",
      memoryKiB: 65_536,
      passes: 3,
      parallelism: 1,
      salt: salt.toString("base64url"),
    });
    expect(newKdfParams({ argon2: false, salt })).toEqual({
      name: "scrypt",
      ...SCRYPT_DEFAULTS,
      salt: salt.toString("base64url"),
    });
    expect(Buffer.from(newKdfParams().salt, "base64url").length).toBe(16);
  });

  test("stored parameters outside the limits are refused before any work", async () => {
    const base = { name: "argon2id", ...ARGON2ID_DEFAULTS, salt: SALT } as const;
    expect(kdfParamsProblem(base)).toBe(null);
    expect(kdfParamsProblem({ ...base, memoryKiB: 64 * 1024 * 1024 })).toBe("memory");
    expect(kdfParamsProblem({ ...base, passes: 0 })).toBe("passes");
    expect(kdfParamsProblem({ ...base, parallelism: 99 })).toBe("parallelism");
    expect(kdfParamsProblem({ ...base, salt: "AAAA" })).toBe("salt too short");
    const scryptBase = { name: "scrypt", ...SCRYPT_DEFAULTS, salt: SALT } as const;
    expect(kdfParamsProblem(scryptBase)).toBe(null);
    expect(kdfParamsProblem({ ...scryptBase, N: 1000 })).toBe("N");
    expect(kdfParamsProblem({ ...scryptBase, r: 0 })).toBe("r");
    expect(kdfParamsProblem({ ...scryptBase, p: 64 })).toBe("p");
    await expect(deriveKek("x", { ...base, passes: 0 })).rejects.toThrow(
      "kdf parameters: passes",
    );
  });
});

describe("wrapping the data key (#142)", () => {
  const kek = Buffer.alloc(32, 9);
  const dek = Buffer.alloc(32, 5);
  const aad = wrapAad("a".repeat(32), "0123456789abcdef", "passphrase");
  const iv = Buffer.alloc(12, 1);

  test("a fixed KEK, key, additional data and IV give fixed bytes", () => {
    // Pinned, so any change to the stored format shows here.
    expect(wrapKey(kek, dek, aad, iv)).toEqual({
      iv: "AQEBAQEBAQEBAQEB",
      data: "vHWEYBbizXUUS1rI4IqFFrnAwc_gxXjF6bYMkSnEXdeRCExiSHSSs2KE1VhVBRul",
    });
  });

  test("wrap then unwrap gives the key back", () => {
    const unwrapped = unwrapKey(kek, wrapKey(kek, dek, aad), aad);
    expect(unwrapped === null ? null : hex(unwrapped)).toBe(hex(dek));
  });

  test("a wrong KEK, other additional data or a changed byte opens nothing", () => {
    const wrapped = wrapKey(kek, dek, aad);
    expect(unwrapKey(Buffer.alloc(32, 8), wrapped, aad)).toBe(null);
    expect(
      unwrapKey(kek, wrapped, wrapAad("b".repeat(32), "0123456789abcdef", "passphrase")),
    ).toBe(null);
    expect(
      unwrapKey(kek, wrapped, wrapAad("a".repeat(32), "0123456789abcdef", "recovery")),
    ).toBe(null);
    const bytes = Buffer.from(wrapped.data, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(unwrapKey(kek, { ...wrapped, data: bytes.toString("base64url") }, aad)).toBe(
      null,
    );
    expect(unwrapKey(kek, { ...wrapped, data: "AAAA" }, aad)).toBe(null);
  });

  test("a wrong passphrase derives a KEK that does not open the key", async () => {
    const params = { name: "scrypt", N: 1024, r: 8, p: 1, salt: SALT } as const;
    const right = await deriveKek("synthetic right passphrase", params);
    const wrong = await deriveKek("synthetic wrong passphrase", params);
    const wrapped = wrapKey(right, dek, aad);
    expect(unwrapKey(wrong, wrapped, aad)).toBe(null);
  });
});

describe("passphrase and recovery code (#142)", () => {
  test("a passphrase needs 12 characters, counted as characters, not bytes", () => {
    expect(passphraseProblem("short one")).toBe("Use at least 12 characters.");
    expect(passphraseProblem("twelve chars")).toBe(null);
    expect(passphraseProblem("ééééééééééé")).toBe("Use at least 12 characters.");
    expect(passphraseProblem(" ".repeat(12))).toBe(
      "Use letters, numbers or words, not spaces.",
    );
    expect(passphraseProblem("x".repeat(1025))).toBe("Use at most 1024 characters.");
  });

  test("base32 follows RFC 4648", () => {
    expect(toBase32(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(toBase32(Buffer.alloc(0))).toBe("");
  });

  test("a recovery code is 20 bytes as eight groups of four", () => {
    expect(newRecoveryCode(Buffer.alloc(20, 0))).toBe(
      "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA",
    );
    expect(newRecoveryCode()).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(formatRecoveryCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  test("typing a code: case, spaces and dashes do not matter; 0, 1, 8 read as O, I, B", () => {
    const code = newRecoveryCode(Buffer.alloc(20, 0xa5));
    const plain = code.replace(/-/g, "");
    expect(normaliseRecoveryCode(code)).toBe(plain);
    expect(normaliseRecoveryCode(code.toLowerCase().replace(/-/g, " "))).toBe(plain);
    expect(normaliseRecoveryCode("0".repeat(32))).toBe("O".repeat(32));
    expect(normaliseRecoveryCode("1".repeat(32))).toBe("I".repeat(32));
    expect(normaliseRecoveryCode("8".repeat(32))).toBe("B".repeat(32));
    expect(normaliseRecoveryCode("A".repeat(31))).toBe(null);
    expect(normaliseRecoveryCode("9".repeat(32))).toBe(null);
  });
});
