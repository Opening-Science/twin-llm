import { describe, expect, test } from "bun:test";

import {
  type RecordingPlan,
  recordingConfigFor,
  rhythmGroundTruth,
} from "@/packages/query-tools/rhythm-recording";
import {
  describeRecording,
  type RhythmIrregularityResult,
} from "@/packages/query-tools/rhythm-tools";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import {
  flaggedSpans,
  intervalCsv,
  metricsSummary,
  pulseStrip,
  recordingFileStem,
  recordingTitle,
  refusalSentence,
  simulatorSettings,
  tachogramPoints,
  thresholdTable,
  windowCsv,
  windowTable,
} from "./simulation-view";

const plan = (afConditionActive: boolean, durationSec = 300): RecordingPlan => ({
  subjectRef: "subject-lab-1",
  recording: 2,
  durationSec,
  date: "2025-06-01",
  afConditionActive,
});

const made = (afConditionActive: boolean, durationSec = 300) => {
  const each = plan(afConditionActive, durationSec);
  const recording = simulateRecording(recordingConfigFor(each));
  const metrics = describeRecording(each);
  return { plan: each, recording, metrics };
};

const asResult = (
  value: ReturnType<typeof describeRecording>,
): RhythmIrregularityResult => {
  if (!("windows" in value)) throw new Error("expected metrics");
  return value;
};

describe("tachogramPoints", () => {
  test("one point per interval, at the beat that ends it", () => {
    const { recording } = made(false);
    const points = tachogramPoints(recording);
    expect(points.length).toBe(recording.rrMs.length);
    expect(points[0]).toEqual({
      t: recording.beatTimesMs[1]! / 1000,
      value: recording.rrMs[0]!,
    });
    expect(points.at(-1)?.t).toBe(recording.beatTimesMs.at(-1)! / 1000);
  });
});

describe("flaggedSpans", () => {
  test("only marked windows, in seconds", () => {
    const { metrics } = made(true);
    const result = asResult(metrics);
    expect(flaggedSpans(result)).toEqual(
      result.windows
        .filter((window) => window.flagged)
        .map((window) => ({ start: window.start_sec, end: window.end_sec })),
    );
  });

  test("a refusal marks nothing", () => {
    expect(flaggedSpans(made(false, 30).metrics)).toEqual([]);
  });
});

describe("pulseStrip", () => {
  test("the first ten seconds at 25 Hz", () => {
    const { recording } = made(false);
    const strip = pulseStrip(recording);
    expect(strip.length).toBe(250);
    expect(strip[1]).toEqual({ t: 0.04, value: recording.pulseWave.values[1]! });
  });

  test("a shorter span when asked", () => {
    expect(pulseStrip(made(false).recording, 2).length).toBe(50);
  });
});

describe("tables", () => {
  test("windowTable formats each window and says marked or not", () => {
    const result = asResult(made(true).metrics);
    const table = windowTable(result);
    expect(table.rows.length).toBe(result.n_windows);
    const w = result.windows[0]!;
    const fixed = (value: number | null, digits: number) =>
      value === null ? "—" : value.toFixed(digits);
    expect(table.rows[0]).toEqual([
      "1",
      fixed(w.start_sec, 1),
      fixed(w.end_sec, 1),
      "128",
      fixed(w.nrmssd, 3),
      fixed(w.turning_point_ratio, 3),
      fixed(w.shannon_entropy, 3),
      fixed(w.sample_entropy, 3),
      w.flagged ? "Marked" : "Not marked",
    ]);
  });

  test("windowCsv keeps unrounded numbers", () => {
    const result = asResult(made(false).metrics);
    const lines = windowCsv(result).split("\r\n");
    const w = result.windows[0]!;
    expect(lines[0]).toBe(
      "window,start_sec,end_sec,n,nrmssd,turning_point_ratio,shannon_entropy,sample_entropy,flagged",
    );
    expect(lines[1]).toBe(
      `1,${w.start_sec},${w.end_sec},128,${w.nrmssd},${w.turning_point_ratio},${w.shannon_entropy},${w.sample_entropy},${w.flagged}`,
    );
  });

  test("intervalCsv marks intervals inside a marked window", () => {
    const { recording } = made(false);
    const lines = intervalCsv(recording, [{ start: 0, end: 1.5 }]).split("\r\n");
    expect(lines[0]).toBe("beat,time_sec,rr_ms,in_flagged_window");
    const t1 = recording.beatTimesMs[1]! / 1000;
    expect(lines[1]).toBe(`1,${t1},${recording.rrMs[0]},${t1 <= 1.5}`);
  });

  test("thresholdTable names each rule and its source", () => {
    expect(thresholdTable().rows).toEqual([
      ["nRMSSD", "above 0.1", "Dash et al. 2009", "Yes"],
      [
        "Turning-point ratio",
        "0.534 to 0.778 (99.9 % band of random values at 128)",
        "Dash et al. 2009",
        "Yes",
      ],
      [
        "Shannon entropy (16 bins)",
        "above 0.7 in the paper",
        "Dash et al. 2009",
        "No: reported, not validated here",
      ],
      [
        "Sample entropy (m 2, r 0.2 SD)",
        "none",
        "Richman and Moorman 2000",
        "No: reported only",
      ],
    ]);
  });
});

describe("summary and settings", () => {
  test("metricsSummary reports the tool's totals", () => {
    const result = asResult(made(false).metrics);
    expect(metricsSummary(result).map((item) => item.label)).toEqual([
      "RR intervals",
      "Mean heart rate",
      "Windows",
      "Marked by the research flag",
    ]);
    expect(metricsSummary(result)[3]?.value).toBe(
      `0 of ${result.n_windows} windows, 0 % of the time`,
    );
  });

  test("simulatorSettings lists the ground truth for an AF day", () => {
    const { plan: each, recording } = made(true);
    const truth = rhythmGroundTruth(each);
    const settings = Object.fromEntries(
      simulatorSettings(each, recording, truth).map((item) => [item.label, item.value]),
    );
    expect(settings["Rhythm setting"]).toBe(
      "Sinus rhythm with an atrial fibrillation episode",
    );
    expect(settings["Atrial fibrillation episodes"]).toBe(
      `${truth.afEpisodes[0]!.startSec} s to ${truth.afEpisodes[0]!.endSec} s`,
    );
    expect(settings["Synthea record"]).toBe(
      "An atrial fibrillation condition (SNOMED CT 49436004) overlaps this day",
    );
    expect(settings.Seed).toBe(String(recording.config.seed));
  });

  test("simulatorSettings for a sinus day has no episode", () => {
    const { plan: each, recording } = made(false);
    const settings = Object.fromEntries(
      simulatorSettings(each, recording, rhythmGroundTruth(each)).map((item) => [
        item.label,
        item.value,
      ]),
    );
    expect(settings["Atrial fibrillation episodes"]).toBe("None");
    expect(settings["Intervals made in AF"]).toBe("0 %");
  });
});

describe("names and refusals", () => {
  test("title and file stem", () => {
    expect(recordingTitle(plan(false))).toBe("Recording 2 on 1 Jun 2025, 300 s");
    expect(recordingFileStem(plan(false))).toBe("rhythm-sim-subject--2025-06-01-r2");
  });

  test("a too-short recording and a day outside the window read as sentences", () => {
    const short = made(false, 30).metrics;
    expect("code" in short && refusalSentence(short)).toBe(
      "This recording has fewer than 128 intervals, too few for one analysis window, so it has no metrics. Try a longer recording.",
    );
    expect(
      refusalSentence({
        code: "OUTSIDE_SUBJECT_WINDOW",
        error: "x",
        date: "2030-01-01",
        window: { start: "2020-01-01", end: "2025-12-31" },
      }),
    ).toBe(
      "This person's observations run from 1 Jan 2020 to 31 Dec 2025. Pick a day in between, or leave the date empty for the last one.",
    );
  });
});
