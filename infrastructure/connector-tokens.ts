import { type FieldCipher } from "./field-cipher";

/**
 * OAuth and BodyLoop tokens under the vault key (#341, docs/privacy-design.md
 * 2.3). A token column holds the provider's env-key ciphertext
 * (`features/<provider>/token-crypto.ts`), and in personal mode that value is
 * sealed again with the person's field subkey, like every other personal
 * column. Without the unlocked vault a copied row opens with neither key
 * alone, and `vault:migrate` and `vault:rotate` treat these columns as they
 * treat the rest (`personal-columns.ts`). A synthetic install's plain cipher
 * leaves the env-key ciphertext as it was.
 *
 * Pure: no I/O. A token never reaches a log or an error message here.
 */

export const TOKEN_COLUMNS = {
  oura_connections: ["accessTokenEnc", "refreshTokenEnc"],
  whoop_connections: ["accessTokenEnc", "refreshTokenEnc"],
  google_health_connections: ["accessTokenEnc", "refreshTokenEnc"],
  vitronic_connections: ["apiTokenEnc", "uploadSecretEnc"],
} as const;

export type TokenTable = keyof typeof TOKEN_COLUMNS;
export type TokenColumn<T extends TokenTable> = (typeof TOKEN_COLUMNS)[T][number];

/** Seals one env-key ciphertext for its row; the context names table, column and row. */
export const sealToken = <T extends TokenTable>(
  cipher: FieldCipher,
  table: T,
  column: TokenColumn<T>,
  rowId: string,
  envCiphertext: string,
): string => cipher.sealText(table, column, rowId, envCiphertext);

/** The env-key ciphertext of a stored token; throws when it does not open. */
export const openToken = <T extends TokenTable>(
  cipher: FieldCipher,
  table: T,
  column: TokenColumn<T>,
  rowId: string,
  stored: string,
): string => cipher.openText(table, column, rowId, stored);
