import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import {
  baseName,
  isZip,
  readZipEntries,
  streamZipEntry,
  zipEntryBytes,
} from "./zip-entries";

const text = (bytes: Uint8Array | null): string | null =>
  bytes === null ? null : new TextDecoder().decode(bytes);

const archive = zipSync({
  "export/stored.txt": [strToU8("made-up stored text"), { level: 0 }],
  "export/deflated.csv": [strToU8("day,steps\n2026-09-01,4321\n".repeat(200)), {}],
});

describe("isZip", () => {
  test("checks the local header signature", () => {
    expect(isZip(archive)).toBe(true);
    expect(isZip(strToU8("<?xml version"))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe("readZipEntries", () => {
  test("lists names and methods from the central directory", () => {
    const listing = readZipEntries(archive);
    expect(
      listing.ok
        ? listing.entries.map((entry) => [entry.name, entry.method, entry.encrypted])
        : null,
    ).toEqual([
      ["export/stored.txt", 0, false],
      ["export/deflated.csv", 8, false],
    ]);
  });

  test("refuses bytes that are not a whole archive", () => {
    expect(readZipEntries(strToU8("not a zip at all, just made-up text"))).toEqual({
      ok: false,
    });
    expect(readZipEntries(archive.subarray(0, archive.byteLength - 30))).toEqual({
      ok: false,
    });
  });
});

describe("zipEntryBytes and streamZipEntry", () => {
  const listing = readZipEntries(archive);
  const entries = listing.ok ? listing.entries : [];

  test("read stored and deflated entries", () => {
    expect(text(zipEntryBytes(entries[0]!))).toBe("made-up stored text");
    expect(text(zipEntryBytes(entries[1]!))).toBe(
      "day,steps\n2026-09-01,4321\n".repeat(200),
    );
  });

  test("streaming gives the same bytes in order", () => {
    const chunks: Uint8Array[] = [];
    expect(streamZipEntry(entries[1]!, (chunk) => chunks.push(chunk))).toBe(true);
    expect(chunks.map((chunk) => new TextDecoder().decode(chunk)).join("")).toBe(
      "day,steps\n2026-09-01,4321\n".repeat(200),
    );
  });

  test("an unknown method or encrypted entry is unreadable", () => {
    const entry = entries[0]!;
    expect(zipEntryBytes({ ...entry, method: 12 })).toBe(null);
    expect(streamZipEntry({ ...entry, encrypted: true }, () => undefined)).toBe(false);
  });

  test("broken deflate data is unreadable, not thrown", () => {
    const broken = { ...entries[1]!, compressed: new Uint8Array([0xff, 0xff, 0xff]) };
    expect(zipEntryBytes(broken)).toBe(null);
    expect(streamZipEntry(broken, () => undefined)).toBe(false);
  });
});

describe("baseName", () => {
  test("drops folders", () => {
    expect(baseName("apple_health_export/export.xml")).toBe("export.xml");
    expect(baseName("Takeout\\Fitbit\\sleep-2026-09-01.json")).toBe(
      "sleep-2026-09-01.json",
    );
    expect(baseName("sleeps.csv")).toBe("sleeps.csv");
  });
});
