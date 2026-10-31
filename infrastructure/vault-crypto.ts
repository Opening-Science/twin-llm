import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import * as nodeCrypto from "node:crypto";

/**
 * The key material of the local unlock (#142, docs/privacy-design.md 2.2).
 *
 * A passphrase (or the recovery code) derives a key-encryption key (KEK) with
 * Argon2id from `node:crypto`; `scrypt` is the fallback when a runtime has no
 * `crypto.argon2`. The KEK wraps the person's data key (DEK) with
 * AES-256-GCM. The KDF's name, parameters and salt are stored with each
 * wrapped key, so they can be raised later and a stored key never depends on
 * today's defaults.
 *
 * No I/O and no logging here: a key, a passphrase or a code never leaves
 * these functions except as the value returned to the caller.
 */

export const DATA_KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_PASSPHRASE_LENGTH = 1024;

export type Argon2idParams = Readonly<{
  name: "argon2id";
  /** Memory in KiB. */
  memoryKiB: number;
  passes: number;
  parallelism: number;
  /** base64url, 16 bytes. */
  salt: string;
}>;

export type ScryptParams = Readonly<{
  name: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
}>;

export type KdfParams = Argon2idParams | ScryptParams;

/** 64 MiB, 3 passes, one lane: about 120 ms on the maintainers' machine. */
export const ARGON2ID_DEFAULTS = Object.freeze({
  memoryKiB: 65_536,
  passes: 3,
  parallelism: 1,
});

/** The documented fallback: N = 2^17, r = 8, p = 1 (128 MiB). */
export const SCRYPT_DEFAULTS = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });

/** Highest stored parameters this build accepts, so a crafted file cannot exhaust memory. */
const LIMITS = Object.freeze({
  memoryKiB: 4 * 1024 * 1024,
  passes: 64,
  parallelism: 16,
  scryptN: 2 ** 22,
  scryptR: 32,
  scryptP: 16,
});

type Argon2Call = (
  algorithm: "argon2id",
  parameters: Readonly<{
    message: Buffer;
    nonce: Buffer;
    parallelism: number;
    tagLength: number;
    memory: number;
    passes: number;
    secret?: Buffer;
    associatedData?: Buffer;
  }>,
  callback: (error: Error | null, key: ArrayBuffer | Uint8Array) => void,
) => void;

const isArgon2Call = (value: unknown): value is Argon2Call => typeof value === "function";

/**
 * `crypto.argon2` (Node 24.7 and later, Bun). Marked experimental in Node, so
 * it is looked up at run time and its absence is a state, not a crash.
 */
const argon2Call = (): Argon2Call | null => {
  const found: unknown = Reflect.get(nodeCrypto, "argon2");
  return isArgon2Call(found) ? found : null;
};

export const argon2Available = (): boolean => argon2Call() !== null;

export type Argon2Input = Readonly<{
  message: Buffer;
  nonce: Buffer;
  memoryKiB: number;
  passes: number;
  parallelism: number;
  tagLength: number;
  secret?: Buffer;
  associatedData?: Buffer;
}>;

/** Raw Argon2id; exported for the RFC 9106 test vector. */
export const argon2id = (input: Argon2Input): Promise<Buffer> => {
  const call = argon2Call();
  if (call === null) return Promise.reject(new Error("argon2 is not available"));
  return new Promise((resolve, reject) => {
    call(
      "argon2id",
      {
        message: input.message,
        nonce: input.nonce,
        parallelism: input.parallelism,
        tagLength: input.tagLength,
        memory: input.memoryKiB,
        passes: input.passes,
        ...(input.secret ? { secret: input.secret } : {}),
        ...(input.associatedData ? { associatedData: input.associatedData } : {}),
      },
      (error, key) => (error ? reject(error) : resolve(Buffer.from(new Uint8Array(key)))),
    );
  });
};

/** Raw scrypt; exported for the RFC 7914 test vector. */
export const scrypt = (
  password: Buffer,
  salt: Buffer,
  options: Readonly<{ N: number; r: number; p: number; keyLength: number }>,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      options.keyLength,
      // maxmem must exceed 128 * N * r, or Node refuses the call.
      { N: options.N, r: options.r, p: options.p, maxmem: 256 * options.N * options.r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });

export const toBase64Url = (bytes: Buffer): string => bytes.toString("base64url");

const fromBase64Url = (text: string): Buffer => Buffer.from(text, "base64url");

/** Fresh parameters for a new wrapped key: Argon2id when the runtime has it, else scrypt. */
export const newKdfParams = (
  options: Readonly<{ argon2: boolean; salt?: Buffer }> = { argon2: argon2Available() },
): KdfParams => {
  const salt = toBase64Url(options.salt ?? randomBytes(SALT_BYTES));
  return options.argon2
    ? { name: "argon2id", ...ARGON2ID_DEFAULTS, salt }
    : { name: "scrypt", ...SCRYPT_DEFAULTS, salt };
};

/** Null when stored parameters are within what this build accepts; else why not. */
export const kdfParamsProblem = (params: KdfParams): string | null => {
  const salt = fromBase64Url(params.salt);
  if (salt.length < SALT_BYTES) return "salt too short";
  if (params.name === "argon2id") {
    const { memoryKiB, passes, parallelism } = params;
    if (!Number.isInteger(memoryKiB) || memoryKiB < 8 * parallelism) return "memory";
    if (memoryKiB > LIMITS.memoryKiB) return "memory";
    if (!Number.isInteger(passes) || passes < 1 || passes > LIMITS.passes)
      return "passes";
    if (!Number.isInteger(parallelism) || parallelism < 1) return "parallelism";
    if (parallelism > LIMITS.parallelism) return "parallelism";
    return null;
  }
  const { N, r, p } = params;
  if (!Number.isInteger(N) || N < 2 || N > LIMITS.scryptN || (N & (N - 1)) !== 0)
    return "N";
  if (!Number.isInteger(r) || r < 1 || r > LIMITS.scryptR) return "r";
  if (!Number.isInteger(p) || p < 1 || p > LIMITS.scryptP) return "p";
  return null;
};

/** The KEK for a passphrase or a normalised recovery code under stored parameters. */
export const deriveKek = (secret: string, params: KdfParams): Promise<Buffer> => {
  const problem = kdfParamsProblem(params);
  if (problem !== null) return Promise.reject(new Error(`kdf parameters: ${problem}`));
  const message = Buffer.from(secret.normalize("NFC"), "utf8");
  const salt = fromBase64Url(params.salt);
  return params.name === "argon2id"
    ? argon2id({
        message,
        nonce: salt,
        memoryKiB: params.memoryKiB,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: DATA_KEY_BYTES,
      })
    : scrypt(message, salt, {
        N: params.N,
        r: params.r,
        p: params.p,
        keyLength: DATA_KEY_BYTES,
      });
};

export type WrappedKey = Readonly<{
  /** base64url, 12 bytes. */
  iv: string;
  /** base64url ciphertext followed by the 16-byte tag. */
  data: string;
}>;

/**
 * Additional data binding a wrapped key to its owner, key id and purpose, so
 * a wrapped key copied into another person's record does not open.
 */
export const wrapAad = (
  userKey: string,
  keyId: string,
  purpose: "passphrase" | "recovery",
): Buffer => Buffer.from(`twinllm.vault.v1|${userKey}|${keyId}|${purpose}`, "utf8");

export const wrapKey = (
  kek: Buffer,
  dek: Buffer,
  aad: Buffer,
  iv: Buffer = randomBytes(IV_BYTES),
): WrappedKey => {
  const cipher = createCipheriv("aes-256-gcm", kek, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
  return { iv: toBase64Url(iv), data: toBase64Url(data) };
};

/** The data key, or null when the KEK or the additional data is wrong (or the bytes changed). */
export const unwrapKey = (
  kek: Buffer,
  wrapped: WrappedKey,
  aad: Buffer,
): Buffer | null => {
  const iv = fromBase64Url(wrapped.iv);
  const sealed = fromBase64Url(wrapped.data);
  if (iv.length !== IV_BYTES || sealed.length !== DATA_KEY_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", kek, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(DATA_KEY_BYTES));
    return Buffer.concat([
      decipher.update(sealed.subarray(0, DATA_KEY_BYTES)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
};

/** A plain sentence when a new passphrase is not acceptable, else null. */
export const passphraseProblem = (passphrase: string): string | null => {
  const length = [...passphrase.normalize("NFC")].length;
  if (length < MIN_PASSPHRASE_LENGTH)
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  if (length > MAX_PASSPHRASE_LENGTH)
    return `Use at most ${MAX_PASSPHRASE_LENGTH} characters.`;
  if (passphrase.trim().length === 0) return "Use letters, numbers or words, not spaces.";
  return null;
};

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_BYTES = 20;
/** 20 bytes are exactly 32 base32 characters. */
const RECOVERY_CHARS = 32;

export const toBase32 = (bytes: Buffer): string => {
  const bits = [...bytes].map((byte) => byte.toString(2).padStart(8, "0")).join("");
  const padded = bits.padEnd(Math.ceil(bits.length / 5) * 5, "0");
  return (padded.match(/.{5}/g) ?? [])
    .map((chunk) => BASE32[Number.parseInt(chunk, 2)])
    .join("");
};

/** 32 base32 characters in eight groups of four: `ABCD-EFGH-...`. */
export const formatRecoveryCode = (code: string): string =>
  (code.match(/.{1,4}/g) ?? []).join("-");

/** A new recovery code (20 random bytes), grouped for reading aloud or writing down. */
export const newRecoveryCode = (bytes: Buffer = randomBytes(RECOVERY_BYTES)): string =>
  formatRecoveryCode(toBase32(bytes));

/**
 * The code as the KDF sees it: upper case, without spaces or dashes; null
 * when it cannot be a recovery code. 0, 1 and 8 typed by mistake read as O,
 * I and B, which base32 does not use.
 */
export const normaliseRecoveryCode = (input: string): string | null => {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/8/g, "B");
  return code.length === RECOVERY_CHARS &&
    [...code].every((char) => BASE32.includes(char))
    ? code
    : null;
};

/** A fresh data key or key id. */
export const newDataKey = (): Buffer => randomBytes(DATA_KEY_BYTES);
export const newKeyId = (): string => randomBytes(8).toString("hex");
