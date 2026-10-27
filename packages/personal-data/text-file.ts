import { createHash } from "node:crypto";

/**
 * Bytes of an uploaded file: its SHA-256 (how a second import of the same
 * file is recognised) and its text. Only UTF-8 is read; anything else is
 * refused rather than decoded into wrong characters.
 */

export const fileSha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    // `fatal` throws on invalid UTF-8; the BOM is dropped by default.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};
