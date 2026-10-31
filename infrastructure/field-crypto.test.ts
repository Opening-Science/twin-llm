import { describe, expect, test } from "bun:test";

import {
  blindIndex,
  deriveSubkey,
  deriveSubkeys,
  ENVELOPE_VERSION,
  envelopeKeyId,
  FieldDecryptError,
  fieldContext,
  isSealedText,
  type OpenProblem,
  openBytes,
  openText,
  sealBytes,
  sealedTextKeyId,
  sealText,
} from "./field-crypto";

const DATA_KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const KEY_ID = "0011223344556677";
const OTHER_ID = "8899aabbccddeeff";
const NONCE = Buffer.alloc(12, 1);
const field = deriveSubkey(DATA_KEY, "field");
const keyFor = (keyId: string) => (keyId === KEY_ID ? field : null);
const context = fieldContext("personal_observations", "display", "row-1");

const problemOf = (run: () => unknown): OpenProblem | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof FieldDecryptError ? error.problem : null;
  }
};

describe("subkeys (#141)", () => {
  test("one HKDF-SHA256 subkey per purpose, fixed for a fixed data key", () => {
    const keys = deriveSubkeys(KEY_ID, DATA_KEY);
    expect(keys.field.length).toBe(32);
    expect(
      new Set([keys.field, keys.index, keys.mesh].map((k) => k.toString("hex"))).size,
    ).toBe(3);
    expect(keys.field.toString("hex")).toBe(
      deriveSubkey(DATA_KEY, "field").toString("hex"),
    );
    // Pinned so a change to the derivation cannot pass unnoticed.
    expect(keys.index.toString("hex")).toBe(
      "428ee3b20ac5be0f366089c5c313dc5d2964839bdc6c88955397a0873ca3a609",
    );
    expect(deriveSubkey(OTHER_KEY, "field").equals(keys.field)).toBe(false);
  });

  test("a key id must be 16 hex characters", () => {
    expect(() => deriveSubkeys("short", DATA_KEY)).toThrow();
  });
});

describe("envelope (#141)", () => {
  test("text round trip, with the key id readable for rotation", () => {
    const sealed = sealText(field, KEY_ID, context, "Hemoglobin A1c");
    expect(isSealedText(sealed)).toBe(true);
    expect(sealed.startsWith(`tlenc1.${KEY_ID}.`)).toBe(true);
    expect(sealed).not.toContain("Hemoglobin");
    expect(sealedTextKeyId(sealed)).toBe(KEY_ID);
    expect(openText(keyFor, context, sealed)).toBe("Hemoglobin A1c");
  });

  test("the empty string and non-ASCII text round trip", () => {
    for (const value of ["", "Grüße 💡", "x".repeat(10_000)]) {
      expect(openText(keyFor, context, sealText(field, KEY_ID, context, value))).toBe(
        value,
      );
    }
  });

  test("a fresh nonce per value: the same value seals differently", () => {
    expect(sealText(field, KEY_ID, context, "same")).not.toBe(
      sealText(field, KEY_ID, context, "same"),
    );
  });

  test("bytes round trip; the header holds version and key id", () => {
    const envelope = sealBytes(field, KEY_ID, context, Buffer.from("glTF..."), NONCE);
    expect(envelope[0]).toBe(ENVELOPE_VERSION);
    expect(envelopeKeyId(envelope)).toBe(KEY_ID);
    expect(openBytes(keyFor, context, envelope).toString()).toBe("glTF...");
  });

  test("tamper: one changed byte anywhere fails", () => {
    const envelope = sealBytes(field, KEY_ID, context, Buffer.from("value 5.4"), NONCE);
    for (let index = 9; index < envelope.length; index += 1) {
      const changed = Buffer.from(envelope);
      changed[index] = (changed[index] ?? 0) ^ 1;
      expect(problemOf(() => openBytes(keyFor, context, changed))).toBe("authentication");
    }
  });

  test("wrong additional data: a value moved to another row or column fails", () => {
    const sealed = sealText(field, KEY_ID, context, "5.4");
    expect(
      problemOf(() =>
        openText(
          keyFor,
          fieldContext("personal_observations", "display", "row-2"),
          sealed,
        ),
      ),
    ).toBe("authentication");
    expect(
      problemOf(() =>
        openText(keyFor, fieldContext("personal_observations", "unit", "row-1"), sealed),
      ),
    ).toBe("authentication");
  });

  test("wrong key: another data key's subkey under the same id fails", () => {
    const sealed = sealText(field, KEY_ID, context, "5.4");
    const other = deriveSubkey(OTHER_KEY, "field");
    expect(problemOf(() => openText(() => other, context, sealed))).toBe(
      "authentication",
    );
  });

  test("unknown key id is refused before any decryption", () => {
    const sealed = sealText(field, OTHER_ID, context, "5.4");
    expect(problemOf(() => openText(keyFor, context, sealed))).toBe("unknown-key");
  });

  test("a changed key id in the header or text fails", () => {
    const envelope = sealBytes(field, KEY_ID, context, Buffer.from("x"), NONCE);
    const relabelled = Buffer.from(envelope);
    Buffer.from(OTHER_ID, "hex").copy(relabelled, 1);
    expect(problemOf(() => openBytes(() => field, context, relabelled))).toBe(
      "authentication",
    );
    const text = sealText(field, KEY_ID, context, "x");
    expect(
      problemOf(() => openText(() => field, context, text.replace(KEY_ID, OTHER_ID))),
    ).toBe("malformed");
  });

  test("version: an unknown format version is refused", () => {
    const envelope = sealBytes(field, KEY_ID, context, Buffer.from("x"), NONCE);
    const future = Buffer.from(envelope);
    future[0] = 2;
    expect(problemOf(() => openBytes(keyFor, context, future))).toBe("version");
    const text = `tlenc1.${KEY_ID}.${future.toString("base64url")}`;
    expect(problemOf(() => openText(keyFor, context, text))).toBe("version");
  });

  test("plain or broken text is never returned as a value", () => {
    expect(problemOf(() => openText(keyFor, context, "Hemoglobin"))).toBe("not-sealed");
    expect(problemOf(() => openText(keyFor, context, "tlenc1.zz"))).toBe("malformed");
    expect(problemOf(() => openText(keyFor, context, `tlenc1.${KEY_ID}.!!`))).toBe(
      "malformed",
    );
    expect(problemOf(() => openBytes(keyFor, context, Buffer.alloc(10)))).toBe(
      "malformed",
    );
  });

  test("the error names the problem only, never the value", () => {
    const sealed = sealText(field, KEY_ID, context, "secret value");
    try {
      openText(keyFor, fieldContext("t", "c", "r"), sealed);
    } catch (error) {
      expect(String(error)).not.toContain("secret");
      expect(String(error)).not.toContain(sealed);
    }
  });
});

describe("blind index (#141)", () => {
  const index = deriveSubkey(DATA_KEY, "index");

  test("equal values give equal hashes; columns and keys separate them", () => {
    const a = blindIndex(index, "personal_variants", "site_index", "chr1:12345");
    expect(a).toBe(blindIndex(index, "personal_variants", "site_index", "chr1:12345"));
    expect(a).toMatch(/^tlix1\.[0-9a-f]{32}$/);
    expect(a).not.toContain("12345");
    expect(a).not.toBe(
      blindIndex(index, "personal_variants", "site_index", "chr1:12346"),
    );
    expect(a).not.toBe(blindIndex(index, "personal_variants", "other", "chr1:12345"));
    expect(a).not.toBe(
      blindIndex(
        deriveSubkey(OTHER_KEY, "index"),
        "personal_variants",
        "site_index",
        "chr1:12345",
      ),
    );
  });
});
