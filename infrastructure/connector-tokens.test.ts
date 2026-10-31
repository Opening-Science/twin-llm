import { describe, expect, test } from "bun:test";

import { openToken, sealToken, TOKEN_COLUMNS } from "./connector-tokens";
import { plainCipher, sealedCipher } from "./field-cipher";
import { FieldDecryptError, sealedTextKeyId } from "./field-crypto";

// Made-up key material and token text, built at run time so no key-shaped
// literal sits in the source.
const KEY = {
  keyId: Array.from({ length: 8 }, (_, i) => (i + 3).toString(16).padStart(2, "0")).join(
    "",
  ),
  dataKey: Buffer.alloc(32, 7),
};
const ENV_CIPHERTEXT = Buffer.from(`synthetic-env-ciphertext-${"x".repeat(8)}`).toString(
  "base64",
);

describe("tokens under the vault key (#341)", () => {
  test("the token columns of each connection table", () => {
    expect(TOKEN_COLUMNS).toEqual({
      oura_connections: ["accessTokenEnc", "refreshTokenEnc"],
      whoop_connections: ["accessTokenEnc", "refreshTokenEnc"],
      google_health_connections: ["accessTokenEnc", "refreshTokenEnc"],
      vitronic_connections: ["apiTokenEnc", "uploadSecretEnc"],
    });
  });

  test("personal mode seals the env-key ciphertext and opens it for the same row", () => {
    const cipher = sealedCipher(KEY);
    const stored = sealToken(
      cipher,
      "oura_connections",
      "accessTokenEnc",
      "row-1",
      ENV_CIPHERTEXT,
    );
    expect(sealedTextKeyId(stored)).toBe(KEY.keyId);
    expect(stored).not.toContain(ENV_CIPHERTEXT);
    expect(openToken(cipher, "oura_connections", "accessTokenEnc", "row-1", stored)).toBe(
      ENV_CIPHERTEXT,
    );
  });

  test("a token moved to another row or column does not open", () => {
    const cipher = sealedCipher(KEY);
    const stored = sealToken(
      cipher,
      "whoop_connections",
      "refreshTokenEnc",
      "row-1",
      ENV_CIPHERTEXT,
    );
    expect(() =>
      openToken(cipher, "whoop_connections", "refreshTokenEnc", "row-2", stored),
    ).toThrow(FieldDecryptError);
    expect(() =>
      openToken(cipher, "whoop_connections", "accessTokenEnc", "row-1", stored),
    ).toThrow(FieldDecryptError);
  });

  test("a row not migrated yet is refused in personal mode, never read as a token", () => {
    expect(() =>
      openToken(
        sealedCipher(KEY),
        "vitronic_connections",
        "apiTokenEnc",
        "row-1",
        ENV_CIPHERTEXT,
      ),
    ).toThrow(new FieldDecryptError("not-sealed"));
  });

  test("a synthetic install keeps the env-key ciphertext as it was", () => {
    const stored = sealToken(
      plainCipher,
      "google_health_connections",
      "accessTokenEnc",
      "row-1",
      ENV_CIPHERTEXT,
    );
    expect(stored).toBe(ENV_CIPHERTEXT);
    expect(
      openToken(
        plainCipher,
        "google_health_connections",
        "accessTokenEnc",
        "row-1",
        stored,
      ),
    ).toBe(ENV_CIPHERTEXT);
  });
});
