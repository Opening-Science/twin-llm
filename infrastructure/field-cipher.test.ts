import { describe, expect, test } from "bun:test";

import {
  openJson,
  openNullable,
  openNumber,
  openTexts,
  plainCipher,
  sealedCipher,
  sealJson,
  sealNullable,
  sealNumber,
} from "./field-cipher";
import { FieldDecryptError } from "./field-crypto";

const OLD = { keyId: "1111111111111111", dataKey: Buffer.alloc(32, 1) };
const NEW = { keyId: "2222222222222222", dataKey: Buffer.alloc(32, 2) };

describe("sealed cipher (#141)", () => {
  const cipher = sealedCipher(OLD);

  test("round trip per column type", () => {
    const text = cipher.sealText("threads", "title", "t1", "Sleep and HRV");
    expect(cipher.openText("threads", "title", "t1", text)).toBe("Sleep and HRV");
    const json = sealJson(cipher, "oura_snapshots", "summary", "s1", { hrv: [41, 44] });
    expect(json).not.toContain("hrv");
    expect(openJson(cipher, "oura_snapshots", "summary", "s1", json)).toEqual({
      hrv: [41, 44],
    });
    const number = sealNumber(cipher, "personal_observations", "value", "o1", 5.4);
    expect(openNumber(cipher, "personal_observations", "value", "o1", number)).toBe(5.4);
    const list = sealJson(cipher, "twin_notes", "topics", "n1", ["sleep", "iron"]);
    expect(openTexts(cipher, "twin_notes", "topics", "n1", list)).toEqual([
      "sleep",
      "iron",
    ]);
    expect(sealNullable(cipher, "t", "c", "r", null)).toBeNull();
    expect(openNullable(cipher, "t", "c", "r", null)).toBeNull();
  });

  test("a plain value is refused, never returned", () => {
    expect(() => cipher.openText("threads", "title", "t1", "Sleep")).toThrow(
      FieldDecryptError,
    );
  });

  test("mixed key ids during rotation: both open, new values use the new key", () => {
    const before = cipher.sealText("turns", "prompt", "p1", "old prompt");
    const rotating = sealedCipher(NEW, [OLD]);
    expect(rotating.activeKeyId).toBe(NEW.keyId);
    expect(rotating.openText("turns", "prompt", "p1", before)).toBe("old prompt");
    const after = rotating.sealText("turns", "prompt", "p1", "new prompt");
    expect(after.startsWith(`tlenc1.${NEW.keyId}.`)).toBe(true);
    // Once the old key is retired its rows no longer open.
    expect(() => sealedCipher(NEW).openText("turns", "prompt", "p1", before)).toThrow(
      FieldDecryptError,
    );
  });

  test("lookups during rotation ask for the hash under every key", () => {
    const rotating = sealedCipher(NEW, [OLD]);
    const hashes = rotating.indexes("personal_variants", "site_index", "1:100");
    expect(hashes).toHaveLength(2);
    expect(hashes).toContain(cipher.index("personal_variants", "site_index", "1:100"));
    expect(hashes[0]).toBe(rotating.index("personal_variants", "site_index", "1:100"));
  });

  test("files round trip and bind their context", () => {
    const sealed = cipher.sealFile("vitronic.mesh.u1.abc", Buffer.from("glTF body"));
    expect(sealed.includes(Buffer.from("glTF"))).toBe(false);
    expect(cipher.openFile("vitronic.mesh.u1.abc", sealed).toString()).toBe("glTF body");
    expect(() => cipher.openFile("vitronic.mesh.u2.abc", sealed)).toThrow(
      FieldDecryptError,
    );
  });
});

describe("plain cipher (synthetic installs)", () => {
  test("stores values as they are and keeps lookups working", () => {
    expect(plainCipher.sealText("threads", "title", "t1", "Demo")).toBe("Demo");
    expect(plainCipher.openText("threads", "title", "t1", "Demo")).toBe("Demo");
    expect(plainCipher.index("a", "b", "x")).toBe(
      plainCipher.indexes("a", "b", "x")[0] ?? "",
    );
    expect(
      openNumber(plainCipher, "a", "b", "r", sealNumber(plainCipher, "a", "b", "r", 3)),
    ).toBe(3);
  });

  test("a sealed value in a synthetic install is refused", () => {
    const sealed = sealedCipher(OLD).sealText("threads", "title", "t1", "x");
    expect(() => plainCipher.openText("threads", "title", "t1", sealed)).toThrow(
      FieldDecryptError,
    );
  });
});
