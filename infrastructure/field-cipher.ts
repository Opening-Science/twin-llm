import { createHash, type KeyObject, randomUUID } from "node:crypto";

import {
  blindIndex,
  deriveSubkeys,
  FieldDecryptError,
  fieldContext,
  isSealedText,
  openBytes,
  openText,
  sealBytes,
  sealText,
  type Subkeys,
} from "./field-crypto";

/**
 * What every store uses to write and read personal columns (#141). A
 * personal install gets a `sealed` cipher built from the person's unlocked
 * keys; a synthetic install gets the `plain` one, which stores values as
 * they are (synthetic rows are public by design). Stores never pick: they
 * ask `cipherForUser` (field-cipher-runtime.ts) and call these functions.
 *
 * A sealed cipher writes with the active key and reads with any key of the
 * keyring, so rows of a retiring key still open during a rotation.
 */

export type FieldCipher = Readonly<{
  mode: "plain" | "sealed";
  /** The key new values are sealed with; null for the plain cipher. */
  activeKeyId: string | null;
  sealText: (table: string, column: string, rowId: string, value: string) => string;
  openText: (table: string, column: string, rowId: string, stored: string) => string;
  /** The lookup hash new rows store (active key). */
  index: (table: string, column: string, value: string) => string;
  /** Every hash a stored row may hold for the value (one per key), for lookups. */
  indexes: (table: string, column: string, value: string) => readonly string[];
  sealFile: (context: string, bytes: Buffer) => Buffer;
  openFile: (context: string, bytes: Buffer) => Buffer;
}>;

export type KeyringEntry = Readonly<{ keyId: string; dataKey: KeyObject | Buffer }>;

/** A personal install's cipher; the first entry is the active key. */
export const sealedCipher = (
  active: KeyringEntry,
  others: readonly KeyringEntry[] = [],
): FieldCipher => {
  const ring: readonly Subkeys[] = [active, ...others].map((entry) =>
    deriveSubkeys(entry.keyId, entry.dataKey),
  );
  const [current] = ring;
  if (current === undefined) throw new Error("no key");
  const byId = new Map(ring.map((subkeys) => [subkeys.keyId, subkeys]));
  const fieldKey = (keyId: string) => byId.get(keyId)?.field ?? null;
  const meshKey = (keyId: string) => byId.get(keyId)?.mesh ?? null;
  return {
    mode: "sealed",
    activeKeyId: current.keyId,
    sealText: (table, column, rowId, value) =>
      sealText(current.field, current.keyId, fieldContext(table, column, rowId), value),
    openText: (table, column, rowId, stored) =>
      openText(fieldKey, fieldContext(table, column, rowId), stored),
    index: (table, column, value) => blindIndex(current.index, table, column, value),
    indexes: (table, column, value) => [
      ...new Set(ring.map((subkeys) => blindIndex(subkeys.index, table, column, value))),
    ],
    sealFile: (context, bytes) => sealBytes(current.mesh, current.keyId, context, bytes),
    openFile: (context, bytes) => openBytes(meshKey, context, bytes),
  };
};

const plainIndex = (table: string, column: string, value: string): string =>
  `plain.${createHash("sha256")
    .update(`${table}.${column}|${value}`, "utf8")
    .digest("hex")
    .slice(0, 32)}`;

/**
 * A synthetic install's cipher: values stay readable. A sealed value found
 * here (the install was switched from personal to synthetic) is refused,
 * never shown as text.
 */
export const plainCipher: FieldCipher = {
  mode: "plain",
  activeKeyId: null,
  sealText: (_table, _column, _rowId, value) => value,
  openText: (_table, _column, _rowId, stored) => {
    if (isSealedText(stored)) throw new FieldDecryptError("unknown-key");
    return stored;
  },
  index: plainIndex,
  indexes: (table, column, value) => [plainIndex(table, column, value)],
  sealFile: (_context, bytes) => bytes,
  openFile: (_context, bytes) => bytes,
};

/**
 * A row id made before the row is written, so that it can be part of each
 * sealed value's context. Stores set ids themselves for every personal row.
 */
export const newRowId = (): string => randomUUID();

// ─── Typed helpers over text ────────────────────────────────────────────────
//
// Every encrypted column is a text column. JSON, numbers and string lists are
// stored as their canonical JSON text and parsed back after opening.

export const sealNullable = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  value: string | null,
): string | null =>
  value === null ? null : cipher.sealText(table, column, rowId, value);

export const openNullable = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  stored: string | null,
): string | null =>
  stored === null ? null : cipher.openText(table, column, rowId, stored);

export const sealJson = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  value: unknown,
): string => cipher.sealText(table, column, rowId, JSON.stringify(value ?? null));

/** The parsed JSON; a value that opens but does not parse is an error, like a bad tag. */
export const openJson = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  stored: string,
): unknown => {
  const text = cipher.openText(table, column, rowId, stored);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FieldDecryptError("malformed");
  }
};

export const sealNullableJson = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  value: unknown,
): string | null =>
  value === null || value === undefined
    ? null
    : sealJson(cipher, table, column, rowId, value);

export const openNullableJson = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  stored: string | null,
): unknown => (stored === null ? null : openJson(cipher, table, column, rowId, stored));

export const sealNumber = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  value: number,
): string => cipher.sealText(table, column, rowId, JSON.stringify(value));

export const openNumber = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  stored: string,
): number => {
  const value = Number(cipher.openText(table, column, rowId, stored));
  if (!Number.isFinite(value)) throw new FieldDecryptError("malformed");
  return value;
};

export const openTexts = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  stored: string,
): string[] => {
  const value = openJson(cipher, table, column, rowId, stored);
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new FieldDecryptError("malformed");
  }
  return value;
};
