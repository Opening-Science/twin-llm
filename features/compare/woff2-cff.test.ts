import { describe, expect, test } from "bun:test";
import { brotliCompressSync } from "node:zlib";

import { cffWoff2ToOpenType } from "./woff2-cff";

type Entry = Readonly<{ tag: string; data: Uint8Array; flags?: number }>;

const KNOWN: Readonly<Record<string, number>> = { head: 1, "CFF ": 13, glyf: 10 };

/** A small WOFF2 file: header, directory, one brotli stream of the tables. */
const woff2 = (entries: readonly Entry[], flavor = "OTTO"): Uint8Array => {
  const directory = entries.flatMap((entry) => {
    const known = KNOWN[entry.tag];
    const flags = entry.flags ?? known ?? 0x3f;
    const tag = known === undefined ? [...entry.tag].map((c) => c.charCodeAt(0)) : [];
    // UIntBase128 of a length under 128 is one byte.
    return [flags, ...tag, entry.data.length];
  });
  const stream = brotliCompressSync(
    Buffer.concat(entries.map((entry) => Buffer.from(entry.data))),
  );
  const header = new DataView(new ArrayBuffer(48));
  header.setUint32(0, 0x774f4632);
  [...flavor].forEach((c, index) => header.setUint8(4 + index, c.charCodeAt(0)));
  header.setUint16(12, entries.length);
  header.setUint32(20, stream.length);
  return new Uint8Array([...new Uint8Array(header.buffer), ...directory, ...stream]);
};

const bytes = (...values: number[]) => new Uint8Array(values);

const tableOf = (font: Uint8Array, tag: string): Uint8Array | null => {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const record = 12 + 16 * index;
    const name = String.fromCharCode(...font.subarray(record, record + 4));
    if (name === tag) {
      const offset = view.getUint32(record + 8);
      return font.subarray(offset, offset + view.getUint32(record + 12));
    }
  }
  return null;
};

describe("a CFF WOFF2 file as OpenType", () => {
  test("tables come back whole, sorted, 4-byte aligned, with OTTO in front", () => {
    const font = cffWoff2ToOpenType(
      woff2([
        { tag: "head", data: bytes(1, 2, 3, 4, 5, 6) },
        { tag: "CFF ", data: bytes(9, 8, 7) },
        { tag: "zzzz", data: bytes(42) },
      ]),
    );
    expect(font).not.toBeNull();
    if (font === null) return;
    expect(String.fromCharCode(...font.subarray(0, 4))).toBe("OTTO");
    const view = new DataView(font.buffer);
    expect(view.getUint16(4)).toBe(3);
    const tags = [0, 1, 2].map((index) =>
      String.fromCharCode(...font.subarray(12 + 16 * index, 16 + 16 * index)),
    );
    expect(tags).toEqual(["CFF ", "head", "zzzz"]);
    expect([...(tableOf(font, "head") ?? [])]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...(tableOf(font, "CFF ") ?? [])]).toEqual([9, 8, 7]);
    expect([...(tableOf(font, "zzzz") ?? [])]).toEqual([42]);
    [0, 1, 2].forEach((index) => {
      expect(view.getUint32(12 + 16 * index + 8) % 4).toBe(0);
    });
  });

  test("anything but plain CFF WOFF2 is null, never a guess", () => {
    const head = { tag: "head", data: bytes(1, 2, 3, 4) };
    // TrueType outlines.
    expect(cffWoff2ToOpenType(woff2([head], "\u0000\u0001\u0000\u0000"))).toBeNull();
    // A transformed table.
    expect(cffWoff2ToOpenType(woff2([{ ...head, flags: 1 | 0x40 }]))).toBeNull();
    // glyf in a CFF font.
    expect(cffWoff2ToOpenType(woff2([head, { tag: "glyf", data: bytes(1) }]))).toBeNull();
    // Not WOFF2, cut short, or a broken stream.
    expect(
      cffWoff2ToOpenType(new TextEncoder().encode("OTTO plain OpenType")),
    ).toBeNull();
    const whole = woff2([head]);
    expect(cffWoff2ToOpenType(whole.subarray(0, whole.length - 2))).toBeNull();
    const broken = whole.slice();
    broken[broken.length - 1] ^= 0xff;
    broken[broken.length - 2] ^= 0xff;
    expect(cffWoff2ToOpenType(broken)).toBeNull();
  });
});
