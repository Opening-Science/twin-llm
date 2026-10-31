import { describe, expect, test } from "bun:test";

import { parseWfdbHeader } from "./wfdb-header";

describe("parseWfdbHeader", () => {
  test("a record with two signals", () => {
    const text = [
      "04015 2 250 9205760  9:00:00",
      "04015.dat 212 0 12 0 -55 -27172 0 ECG1",
      "04015.dat 212 0 12 0 -42 -28460 0 ECG2",
      "",
    ].join("\n");
    expect(parseWfdbHeader(text)).toEqual({
      record: "04015",
      nSignals: 2,
      samplingHz: 250,
      nSamples: 9_205_760,
      baseTime: "9:00:00",
      signals: [
        { file: "04015.dat", format: "212", description: "ECG1" },
        { file: "04015.dat", format: "212", description: "ECG2" },
      ],
    });
  });

  test("a record without signals (annotations only)", () => {
    expect(parseWfdbHeader("00735 0 250 0\n")).toEqual({
      record: "00735",
      nSignals: 0,
      samplingHz: 250,
      nSamples: null,
      baseTime: null,
      signals: [],
    });
  });

  test("comments, counter frequency and a missing frequency", () => {
    expect(parseWfdbHeader("# note\nrec/3 1 360/2(0)\nrec.dat 16\n").samplingHz).toBe(
      360,
    );
    expect(parseWfdbHeader("rec 0\n").samplingHz).toBe(250);
    expect(parseWfdbHeader("rec/3 0\n").record).toBe("rec");
  });

  test("bad headers throw", () => {
    expect(() => parseWfdbHeader("# only a comment\n")).toThrow("empty WFDB header");
    expect(() => parseWfdbHeader("rec x 250\n")).toThrow("bad signal count");
    expect(() => parseWfdbHeader("rec 1 0\n")).toThrow("bad sampling frequency");
  });

  test("a Long-Term AF Database record: 128 Hz, about 21 h, date after the time", () => {
    const text = [
      "00 2 128 9661440  9:30:00 31/01/2003",
      "00.dat 16 166.945/mV 0 0 -1 -8202 0 ECG",
      "00.dat 16 173.01/mV 0 0 3 6311 0 ECG",
      "",
    ].join("\n");
    const header = parseWfdbHeader(text);
    expect(header.samplingHz).toBe(128);
    expect(header.nSamples).toBe(9_661_440);
    expect(header.baseTime).toBe("9:30:00");
    expect(header.signals.map((each) => each.format)).toEqual(["16", "16"]);
  });
});
