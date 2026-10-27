import { describe, expect, test } from "bun:test";

import { detectDelimiter, parseDelimited } from "./delimited";
import { parseEffectiveTime } from "./effective-time";
import { isLoincCode } from "./loinc-code";
import { decodeUtf8, fileSha256 } from "./text-file";

describe("parseDelimited", () => {
  test("quoted fields, doubled quotes, CRLF and blank lines", () => {
    expect(parseDelimited('a,b\r\n"x, y","say ""hi"""\r\n\r\n1,\n', ",")).toEqual({
      ok: true,
      rows: [
        ["a", "b"],
        ["x, y", 'say "hi"'],
        ["1", ""],
      ],
    });
  });

  test("a newline inside quotes stays in the field", () => {
    expect(parseDelimited('a\tb\n"two\nlines"\tz', "\t")).toEqual({
      ok: true,
      rows: [
        ["a", "b"],
        ["two\nlines", "z"],
      ],
    });
  });

  test("a quote left open is an error with its line", () => {
    expect(parseDelimited('a,b\n1,2\n"open,3\n4,5', ",")).toEqual({ ok: false, line: 3 });
  });

  test("detects tab, then semicolon over comma", () => {
    expect(detectDelimiter("a\tb,c\n")).toBe("\t");
    expect(detectDelimiter("a;b;c,d\n")).toBe(";");
    expect(detectDelimiter("a,b;c\n")).toBe(",");
  });
});

describe("parseEffectiveTime", () => {
  test("partial dates keep their precision", () => {
    expect(parseEffectiveTime("2024")).toEqual({
      ok: true,
      time: { at: new Date("2024-01-01T00:00:00Z"), precision: "year" },
    });
    expect(parseEffectiveTime("2024-03")).toEqual({
      ok: true,
      time: { at: new Date("2024-03-01T00:00:00Z"), precision: "month" },
    });
    expect(parseEffectiveTime(" 2024-03-09 ")).toEqual({
      ok: true,
      time: { at: new Date("2024-03-09T00:00:00Z"), precision: "day" },
    });
  });

  test("a time with a zone is an instant; a space may stand for T", () => {
    expect(parseEffectiveTime("2025-05-20 08:30:00+02:00")).toEqual({
      ok: true,
      time: { at: new Date("2025-05-20T06:30:00Z"), precision: "instant" },
    });
  });

  test("a time without a zone, a rolled-over day and nothing are refused", () => {
    expect(parseEffectiveTime("2025-05-20T08:30:00")).toEqual({
      ok: false,
      reason: "no-time-zone",
    });
    expect(parseEffectiveTime("2024-02-30")).toEqual({ ok: false, reason: "not-a-date" });
    expect(parseEffectiveTime("20/05/2025")).toEqual({ ok: false, reason: "not-a-date" });
    expect(parseEffectiveTime("")).toEqual({ ok: false, reason: "no-date" });
    expect(parseEffectiveTime(null)).toEqual({ ok: false, reason: "no-date" });
  });
});

describe("isLoincCode", () => {
  test("codes with the right check digit", () => {
    expect(
      ["4548-4", "2339-0", "8480-6", "8462-4", "2093-3", "777-3"].map(isLoincCode),
    ).toEqual([true, true, true, true, true, true]);
  });

  test("a wrong check digit or format is refused", () => {
    expect(
      ["4548-5", "2339-1", "45484", "LP1234-5", "", "12345678-9"].map(isLoincCode),
    ).toEqual([false, false, false, false, false, false]);
  });
});

describe("text-file", () => {
  test("SHA-256 of the bytes", () => {
    expect(fileSha256(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("UTF-8 with or without a BOM; anything else is null", () => {
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(decodeUtf8(new TextEncoder().encode("Hämoglobin"))).toBe("Hämoglobin");
    expect(decodeUtf8(new Uint8Array([0x48, 0xe4, 0x6d]))).toBeNull();
  });
});
