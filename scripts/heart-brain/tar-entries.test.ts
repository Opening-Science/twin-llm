import { describe, expect, test } from "bun:test";

import { BLOCK, parseTarHeader, paxPath, tarEntries } from "./tar-entries";

const encoder = new TextEncoder();

const header = (name: string, size: number, type: string): Uint8Array => {
  const block = new Uint8Array(BLOCK);
  block.set(encoder.encode(name), 0);
  block.set(encoder.encode(size.toString(8).padStart(11, "0")), 124);
  block.set(encoder.encode(type), 156);
  block.set(encoder.encode("ustar"), 257);
  return block;
};

const body = (text: string): Uint8Array => {
  const bytes = encoder.encode(text);
  const padded = new Uint8Array(Math.ceil(bytes.length / BLOCK) * BLOCK);
  padded.set(bytes);
  return padded;
};

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((offset, part) => {
    out.set(part, offset);
    return offset + part.length;
  }, 0);
  return out;
};

/** Splits bytes into uneven chunks, as a pipe would deliver them. */
async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let start = 0; start < bytes.length; start += size) {
    yield bytes.subarray(start, start + size);
  }
}

const collect = async (bytes: Uint8Array, chunk: number) => {
  const out: { name: string; text: string }[] = [];
  for await (const entry of tarEntries(chunked(bytes, chunk))) {
    out.push({ name: entry.name, text: new TextDecoder().decode(entry.bytes) });
  }
  return out;
};

const longName = `fhir/${"x".repeat(120)}.json`;
const archive = concat([
  header("fhir/", 0, "5"),
  header("fhir/a.json", 7, "0"),
  body('{"a":1}'),
  header("././@LongLink", longName.length + 1, "L"),
  body(`${longName}\0`),
  header("fhir/truncated", 2, "0"),
  body("{}"),
  new Uint8Array(BLOCK * 2),
]);

describe("parseTarHeader", () => {
  test("reads name, octal size and type", () => {
    expect(parseTarHeader(header("fhir/a.json", 1000, "0"))).toEqual({
      name: "fhir/a.json",
      size: 1000,
      type: "0",
    });
  });

  test("an all-zero block ends the archive", () => {
    expect(parseTarHeader(new Uint8Array(BLOCK))).toBeNull();
  });
});

describe("paxPath", () => {
  test("finds the path record", () => {
    expect(paxPath(encoder.encode("30 mtime=1\n25 path=fhir/long.json\n"))).toBe(
      "fhir/long.json",
    );
    expect(paxPath(encoder.encode("12 mtime=1\n"))).toBeNull();
  });
});

describe("tarEntries", () => {
  test("yields files only, with GNU long names, whatever the chunk size", async () => {
    const expected = [
      { name: "fhir/a.json", text: '{"a":1}' },
      { name: longName, text: "{}" },
    ];
    expect(await collect(archive, 7)).toEqual(expected);
    expect(await collect(archive, 4096)).toEqual(expected);
  });

  test("a stream cut inside a file throws", async () => {
    const cut = archive.subarray(0, BLOCK * 2 + 3);
    await expect(collect(cut, 64)).rejects.toThrow("tar stream ends inside fhir/a.json");
  });
});
