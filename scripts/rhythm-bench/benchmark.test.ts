import { describe, expect, test } from "bun:test";

import {
  type AfdbRecordInput,
  type BenchmarkInputs,
  recordWindows,
  runBenchmark,
  simulateCellWindows,
} from "./benchmark";
import {
  markdownReport,
  rocCsv,
  distributionCsv,
  simWindowsCsv,
  realNoiseCsv,
  realNoiseWindowsCsv,
  realWindowsCsv,
} from "./report";
import { NOISE_LEVELS, RHYTHM_CONDITIONS } from "./sim-grid";

const condition = (id: string) => {
  const found = RHYTHM_CONDITIONS.find((each) => each.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

/** A synthetic annotated record: 300 beats at 200 samples (800 ms), AF from beat 150 on. */
const fakeRecord = (record: string, jitter: number): AfdbRecordInput => {
  const steps = Array.from({ length: 300 }, (_, i) =>
    i < 150 ? 200 + (i % 3) : 120 + ((i * jitter) % 97),
  );
  const beats = steps.reduce<number[]>(
    (out, step) => [...out, (out.at(-1) ?? 0) + step],
    [],
  );
  return {
    record,
    beatAnnotator: "qrs",
    samplingHz: 250,
    hasSignalFile: false,
    beats,
    rhythmChanges: [
      { sample: 0, rhythm: "N" },
      { sample: beats[150], rhythm: "AFIB" },
    ],
  };
};

const INPUTS: BenchmarkInputs = {
  options: {
    seeds: 2,
    bootstrapSeed: 3,
    resamples: 20,
    grid: {
      durations: [60, 120],
      rhythms: [
        condition("sinus+ectopy-2/1"),
        condition("paroxysmal-60%"),
        condition("persistent"),
      ],
      afRates: [100],
      noise: [NOISE_LEVELS[0], NOISE_LEVELS[2]],
    },
  },
  gitSha: "0000000",
  afdb: { records: [fakeRecord("r1", 31), fakeRecord("r2", 53)], sha256SumsFile: "ab" },
};

describe("runBenchmark", () => {
  test("same seed, same JSON and CSVs (the timestamp is the caller's)", () => {
    const a = runBenchmark(INPUTS);
    const b = runBenchmark(INPUTS);
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
    expect(markdownReport(a.result, "t")).toBe(markdownReport(b.result, "t"));
    for (const render of [simWindowsCsv, realWindowsCsv, rocCsv, distributionCsv]) {
      expect(render(a)).toBe(render(b));
    }
  });

  test("another bootstrap seed changes intervals, not point estimates", () => {
    const a = runBenchmark(INPUTS).result;
    const b = runBenchmark({
      ...INPUTS,
      options: { ...INPUTS.options, bootstrapSeed: 4 },
    }).result;
    expect(b.simulated.overall.sensitivity.value).toBe(
      a.simulated.overall.sensitivity.value,
    );
    expect(b.runId).not.toBe(a.runId);
  });

  test("records, run id and the shape of the result", () => {
    const { result } = runBenchmark(INPUTS);
    expect(result.runId).toMatch(/^[0-9a-f]{16}$/);
    expect(result.simulated.recordings).toBe(2 * (1 + 2) * 2 * 2);
    expect(result.real?.records.map((record) => [record.record, record.windows])).toEqual(
      [
        ["r1", 2],
        ["r2", 2],
      ],
    );
    expect(result.real?.records[0].rhythmIntervals).toEqual({ AFIB: 107, N: 149 });
    expect(
      result.simToReal.map((each) => `${each.noise}:${each.simClass}:${each.realClass}`),
    ).toEqual(["none:af:AFIB", "none:not-af:N", "heavy:af:AFIB", "heavy:not-af:N"]);
  });

  test("real noise: level none matches the database result; off by default", () => {
    expect(runBenchmark(INPUTS).result.realNoise).toBe(null);
    const withNoise = { ...INPUTS, options: { ...INPUTS.options, realNoise: true } };
    const data = runBenchmark(withNoise);
    const levels = data.result.realNoise ?? [];
    expect(levels.map((each) => each.noise)).toEqual(["none", "heavy"]);
    expect(levels[0].summary.sensitivity.value).toBe(
      data.result.real?.overall.sensitivity.value ?? null,
    );
    expect(levels[0].summary.specificity.value).toBe(
      data.result.real?.overall.specificity.value ?? null,
    );
    expect(markdownReport(data.result, "t")).toContain(
      "## Beat-detection noise on database beats",
    );
    expect(realNoiseCsv(data.result).split("\n")[1]).toMatch(/^real,none,/);
    const again = runBenchmark(withNoise);
    expect(realNoiseCsv(again.result)).toBe(realNoiseCsv(data.result));
    expect(realNoiseWindowsCsv(again)).toBe(realNoiseWindowsCsv(data));
  });

  test("the database is named in the result and the report", () => {
    expect(runBenchmark(INPUTS).result.real?.databaseId).toBe("afdb");
    const lt = runBenchmark({
      ...INPUTS,
      afdb: {
        database: "ltafdb",
        records: [{ ...fakeRecord("r1", 31), beatAnnotator: "atr", samplingHz: 128 }],
        sha256SumsFile: null,
      },
    }).result;
    expect(lt.real?.database).toBe("Long-Term AF Database 1.0.0 (PhysioNet)");
    expect(markdownReport(lt, "t")).toContain(
      "## Open recordings: Long-Term AF Database 1.0.0 (PhysioNet)",
    );
    expect(markdownReport(lt, "t")).toContain(
      "Reference rhythm and beats from the .atr files",
    );
  });

  test("AF dependence: independent by default with the old run id; short_range changes AF windows only", () => {
    const independent = runBenchmark(INPUTS);
    const shortRange = runBenchmark({
      ...INPUTS,
      options: { ...INPUTS.options, afDependence: "short_range" },
    });
    expect(independent.result.options.afDependence).toBe("independent");
    expect(shortRange.result.options.afDependence).toBe("short_range");
    expect(shortRange.result.runId).not.toBe(independent.result.runId);
    const sinusOf = (data: typeof independent) =>
      data.simRows.filter((row) => row.rhythm === "sinus+ectopy-2/1");
    expect(sinusOf(shortRange)).toEqual(sinusOf(independent));
    const afOf = (data: typeof independent) =>
      data.simRows.filter((row) => row.rhythm === "persistent").map((row) => row.rr);
    expect(afOf(shortRange)).not.toEqual(afOf(independent));
    expect(
      independent.result.afDependence.map(({ sim, real }) => [sim.lag, real?.lag]),
    ).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(independent.result.afDependence[0].real?.clusters).toBe(0);
    expect(markdownReport(shortRange.result, "t")).toContain(
      "Simulated AF mode `short_range`.",
    );
  });

  test("without the database the real part is null", () => {
    const { result, realRows } = runBenchmark({ ...INPUTS, afdb: null });
    expect(result.real).toBe(null);
    expect(result.simToReal).toEqual([]);
    expect(realRows).toEqual([]);
    expect(result.afDependence.every((each) => each.real === null)).toBe(true);
  });
});

describe("simulateCellWindows", () => {
  test("persistent AF windows are all AF; sinus windows none", () => {
    const af = simulateCellWindows(
      {
        durationSec: 300,
        rhythm: condition("persistent"),
        afRate: 100,
        noise: NOISE_LEVELS[0],
      },
      0,
    );
    const sinus = simulateCellWindows(
      {
        durationSec: 300,
        rhythm: condition("sinus"),
        afRate: null,
        noise: NOISE_LEVELS[0],
      },
      0,
    );
    expect(af.every((row) => row.afShare === 1 && row.n === 128)).toBe(true);
    expect(sinus.every((row) => row.afShare === 0)).toBe(true);
    expect(af.length > 0 && sinus.length > 0).toBe(true);
  });
});

describe("recordWindows", () => {
  test("windows of a record are numbered across segments", () => {
    expect(
      recordWindows(fakeRecord("r", 31)).map((row) => [
        row.index,
        row.dominant,
        row.positive,
      ]),
    ).toEqual([
      [0, "N", false],
      [1, "AFIB", true],
    ]);
  });
});
