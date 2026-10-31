import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  type KeyObject,
  randomBytes,
} from "node:crypto";

/**
 * Encryption at rest of personal values (#141, docs/privacy-design.md 2.3).
 *
 * Three subkeys come from the person's data key with HKDF-SHA256, one per
 * purpose: `field` encrypts column values, `index` makes the keyed hashes
 * (HMAC-SHA256) that equality lookups use, and `mesh` encrypts BodyLoop mesh
 * files. A value is sealed with AES-256-GCM under a random 96-bit nonce, and
 * its header (format version and key id) plus a context string
 * (`<table>.<column>.<row id>`) are the additional data, so a value moved to
 * another row, column or key does not open.
 *
 * Binary envelope: version (1 byte) | key id (8 bytes) | nonce (12) |
 * ciphertext | tag (16). In a text column it is written
 * `tlenc1.<key id hex>.<base64url envelope>`, so SQL can tell sealed from
 * plain (`LIKE 'tlenc1.%'`) and find the rows of one key during rotation
 * (`LIKE 'tlenc1.<key id>.%'`) without decrypting anything.
 *
 * Pure: no I/O, no logging. A key never leaves these functions except as the
 * value returned to the caller.
 */

export const ENVELOPE_VERSION = 1;
export const TEXT_PREFIX = "tlenc1.";
/** Prefix of a keyed lookup hash, so a hash is never taken for a plain value. */
export const INDEX_PREFIX = "tlix1.";

const KEY_ID_BYTES = 8;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + KEY_ID_BYTES;
const MIN_ENVELOPE = HEADER_BYTES + NONCE_BYTES + TAG_BYTES;
/** 16 bytes of the HMAC: enough to never collide within one person's rows. */
const INDEX_BYTES = 16;

export type SubkeyPurpose = "field" | "index" | "mesh";

const KEY_ID = /^[0-9a-f]{16}$/;

export const isKeyId = (value: string): boolean => KEY_ID.test(value);

/** One data key's three subkeys. */
export type Subkeys = Readonly<{
  keyId: string;
  field: Buffer;
  index: Buffer;
  mesh: Buffer;
}>;

/** HKDF-SHA256 of the data key; the info names the purpose and the format version. */
export const deriveSubkey = (
  dataKey: KeyObject | Buffer,
  purpose: SubkeyPurpose,
): Buffer =>
  Buffer.from(
    hkdfSync(
      "sha256",
      dataKey,
      Buffer.alloc(0),
      Buffer.from(`twinllm.${purpose}.v${ENVELOPE_VERSION}`, "utf8"),
      32,
    ),
  );

export const deriveSubkeys = (keyId: string, dataKey: KeyObject | Buffer): Subkeys => {
  if (!isKeyId(keyId)) throw new Error("key id is not 16 hex characters");
  return {
    keyId,
    field: deriveSubkey(dataKey, "field"),
    index: deriveSubkey(dataKey, "index"),
    mesh: deriveSubkey(dataKey, "mesh"),
  };
};

/** Why a value did not open. Never carries the value or a key. */
export type OpenProblem =
  "not-sealed" | "malformed" | "version" | "unknown-key" | "authentication";

export class FieldDecryptError extends Error {
  readonly problem: OpenProblem;
  constructor(problem: OpenProblem) {
    super(`personal value did not decrypt: ${problem}`);
    this.name = "FieldDecryptError";
    this.problem = problem;
  }
}

const header = (keyId: string, version: number): Buffer =>
  Buffer.concat([Buffer.from([version]), Buffer.from(keyId, "hex")]);

const additionalData = (head: Buffer, context: string): Buffer =>
  Buffer.concat([head, Buffer.from(`|${context}`, "utf8")]);

/** The context string of a column value: `<table>.<column>.<row id>`. */
export const fieldContext = (table: string, column: string, rowId: string): string =>
  `${table}.${column}.${rowId}`;

/** Seals bytes under `key` (a 32-byte subkey) into the binary envelope. */
export const sealBytes = (
  key: Buffer,
  keyId: string,
  context: string,
  plaintext: Buffer,
  nonce: Buffer = randomBytes(NONCE_BYTES),
): Buffer => {
  if (!isKeyId(keyId)) throw new Error("key id is not 16 hex characters");
  if (nonce.length !== NONCE_BYTES) throw new Error("nonce must be 12 bytes");
  const head = header(keyId, ENVELOPE_VERSION);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(head, context));
  return Buffer.concat([
    head,
    nonce,
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
};

/** The key id an envelope names, or null when it is not one. */
export const envelopeKeyId = (envelope: Buffer): string | null =>
  envelope.length >= MIN_ENVELOPE && envelope[0] === ENVELOPE_VERSION
    ? envelope.subarray(1, HEADER_BYTES).toString("hex")
    : null;

/**
 * Opens a binary envelope. `keyFor` returns the subkey for a key id, or null
 * when this keyring does not hold it. Throws `FieldDecryptError`; never
 * returns a partial or empty value in place of a failure.
 */
export const openBytes = (
  keyFor: (keyId: string) => Buffer | null,
  context: string,
  envelope: Buffer,
): Buffer => {
  if (envelope.length < MIN_ENVELOPE) throw new FieldDecryptError("malformed");
  const version = envelope[0];
  if (version !== ENVELOPE_VERSION) throw new FieldDecryptError("version");
  const head = envelope.subarray(0, HEADER_BYTES);
  const keyId = head.subarray(1).toString("hex");
  const key = keyFor(keyId);
  if (key === null) throw new FieldDecryptError("unknown-key");
  const nonce = envelope.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
  const sealed = envelope.subarray(HEADER_BYTES + NONCE_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(additionalData(head, context));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    throw new FieldDecryptError("authentication");
  }
};

export const isSealedText = (value: string): boolean => value.startsWith(TEXT_PREFIX);

/** `tlenc1.<key id>.<base64url envelope>` for a text column. */
export const sealText = (
  key: Buffer,
  keyId: string,
  context: string,
  plaintext: string,
  nonce?: Buffer,
): string =>
  `${TEXT_PREFIX}${keyId}.${sealBytes(key, keyId, context, Buffer.from(plaintext, "utf8"), nonce).toString("base64url")}`;

/** The key id a sealed text names, or null when it is not sealed text. */
export const sealedTextKeyId = (value: string): string | null => {
  if (!isSealedText(value)) return null;
  const keyId = value.slice(TEXT_PREFIX.length, TEXT_PREFIX.length + 16);
  return isKeyId(keyId) && value[TEXT_PREFIX.length + 16] === "." ? keyId : null;
};

export const openText = (
  keyFor: (keyId: string) => Buffer | null,
  context: string,
  value: string,
): string => {
  if (!isSealedText(value)) throw new FieldDecryptError("not-sealed");
  const keyId = sealedTextKeyId(value);
  if (keyId === null) throw new FieldDecryptError("malformed");
  const body = value.slice(TEXT_PREFIX.length + 17);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new FieldDecryptError("malformed");
  const envelope = Buffer.from(body, "base64url");
  // The key id in the text must be the one inside the envelope.
  if (envelopeKeyId(envelope) !== keyId) {
    throw new FieldDecryptError(
      envelope[0] === ENVELOPE_VERSION ? "malformed" : "version",
    );
  }
  return openBytes(keyFor, context, envelope).toString("utf8");
};

/**
 * A keyed lookup hash: `tlix1.` and the first 16 bytes of
 * HMAC-SHA256(index key, `<table>.<column>|<value>`) in hex. Equal values in
 * the same column give equal hashes, so equality queries still work; the
 * value itself cannot be read back, and without the key it cannot be guessed.
 */
export const blindIndex = (
  indexKey: Buffer,
  table: string,
  column: string,
  value: string,
): string =>
  `${INDEX_PREFIX}${createHmac("sha256", indexKey)
    .update(`${table}.${column}|${value}`, "utf8")
    .digest()
    .subarray(0, INDEX_BYTES)
    .toString("hex")}`;
