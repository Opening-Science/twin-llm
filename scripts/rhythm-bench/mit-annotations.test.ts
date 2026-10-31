import { describe, expect, test } from "bun:test";

import { beatSamples, parseMitAnnotations, rhythmChanges } from "./mit-annotations";

// Hand-built after annot(5): 16-bit little-endian words, type in the top 6
// bits, time increment in the low 10.
const RHYTHM_FILE = new Uint8Array([
  30,
  112, //                  RHYTHM (28), I = 30
  2,
  252,
  40,
  78, //           AUX (63), 2 bytes: "(N"
  0,
  236,
  1,
  0,
  154,
  144, //   SKIP (59): high word 1, low word 0x909a, 102554 samples
  0,
  112, //                   RHYTHM, I = 0
  5,
  252,
  40,
  65,
  70,
  73,
  66,
  0, // AUX, 5 bytes "(AFIB" and one pad byte
  0,
  0, //                     end of file
  61,
  4, //                    after the end; never read
]);

const BEAT_FILE = new Uint8Array([
  61,
  4, //    NORMAL (1), I = 61
  139,
  4, //   NORMAL, I = 139
  3,
  244, //   SUB (61) = 3
  1,
  248, //   CHN (62) = 1
  2,
  240, //   NUM (60) = 2
  100,
  20, //  PVC (5), I = 100
  10,
  64, //   ARFCT (16), I = 10
  0,
  0,
]);

describe("parseMitAnnotations", () => {
  test("rhythm annotations with aux strings and a SKIP", () => {
    expect(parseMitAnnotations(RHYTHM_FILE)).toEqual([
      { sample: 30, code: 28, subtype: 0, chan: 0, num: 0, aux: "(N" },
      { sample: 102_584, code: 28, subtype: 0, chan: 0, num: 0, aux: "(AFIB" },
    ]);
  });

  test("beat annotations with SUB, CHN and NUM; chan and num carry on", () => {
    expect(parseMitAnnotations(BEAT_FILE)).toEqual([
      { sample: 61, code: 1, subtype: 0, chan: 0, num: 0, aux: null },
      { sample: 200, code: 1, subtype: 3, chan: 1, num: 2, aux: null },
      { sample: 300, code: 5, subtype: 0, chan: 1, num: 2, aux: null },
      { sample: 310, code: 16, subtype: 0, chan: 1, num: 2, aux: null },
    ]);
  });

  test("a negative SKIP moves time back", () => {
    const bytes = new Uint8Array([100, 4, 0, 236, 255, 255, 246, 255, 20, 4, 0, 0]);
    expect(parseMitAnnotations(bytes).map((each) => each.sample)).toEqual([100, 110]);
  });

  test("a file without the end marker is read to its last word", () => {
    expect(
      parseMitAnnotations(new Uint8Array([10, 4, 10, 4])).map((each) => each.sample),
    ).toEqual([10, 20]);
  });

  test("a truncated SKIP or AUX throws", () => {
    expect(() => parseMitAnnotations(new Uint8Array([0, 236, 1, 0]))).toThrow(
      "truncated SKIP",
    );
    expect(() => parseMitAnnotations(new Uint8Array([10, 4, 5, 252, 40]))).toThrow(
      "truncated AUX",
    );
  });
});

describe("beatSamples and rhythmChanges", () => {
  test("beats leave out artefacts and non-beat codes", () => {
    expect(beatSamples(parseMitAnnotations(BEAT_FILE))).toEqual([61, 200, 300]);
  });

  test("rhythm changes drop the opening parenthesis", () => {
    expect(rhythmChanges(parseMitAnnotations(RHYTHM_FILE))).toEqual([
      { sample: 30, rhythm: "N" },
      { sample: 102_584, rhythm: "AFIB" },
    ]);
  });

  test("RHYTHM annotations without a parenthesised aux are not rhythm changes", () => {
    const bytes = new Uint8Array([30, 112, 2, 252, 65, 66, 0, 0]);
    expect(rhythmChanges(parseMitAnnotations(bytes))).toEqual([]);
  });
});

// A Long-Term AF Database style .atr (#264): beats labelled by type, a NOTE
// with an aux string and RHYTHM changes in the same file.
const LTAFDB_ATR = new Uint8Array([
  0,
  112, //                  RHYTHM (28), I = 0
  2,
  252,
  40,
  78, //           AUX, 2 bytes: "(N"
  128,
  4, //                    NORMAL (1), I = 128
  100,
  20, //                   PVC (5), I = 100
  0,
  88, //                   NOTE (22), I = 0
  5,
  252,
  77,
  73,
  83,
  83,
  66,
  0, // AUX, 5 bytes "MISSB" and one pad byte
  90,
  32, //                   APC (8), I = 90
  0,
  112, //                  RHYTHM, I = 0
  5,
  252,
  40,
  65,
  70,
  73,
  66,
  0, // AUX, "(AFIB"
  110,
  52, //                   UNKNOWN (13), I = 110
  0,
  0,
]);

describe("a reference file with beats and rhythm (Long-Term AF Database)", () => {
  test("beats of every type, notes and rhythm annotations left out", () => {
    expect(beatSamples(parseMitAnnotations(LTAFDB_ATR))).toEqual([128, 228, 318, 428]);
  });

  test("rhythm changes from the same file", () => {
    expect(rhythmChanges(parseMitAnnotations(LTAFDB_ATR))).toEqual([
      { sample: 0, rhythm: "N" },
      { sample: 318, rhythm: "AFIB" },
    ]);
  });

  test("the note keeps its aux string and does not count as a beat", () => {
    const note = parseMitAnnotations(LTAFDB_ATR).find((each) => each.code === 22);
    expect(note).toEqual({
      sample: 228,
      code: 22,
      subtype: 0,
      chan: 0,
      num: 0,
      aux: "MISSB",
    });
  });
});
