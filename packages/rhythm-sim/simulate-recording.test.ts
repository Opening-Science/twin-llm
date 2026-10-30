import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { type Recording, beatTimesOf, simulateRecording } from "./simulate-recording";

const sha = (recording: Recording): string =>
  createHash("sha256")
    .update(JSON.stringify([recording.rrMs, recording.labels]))
    .digest("hex")
    .slice(0, 16);

const meanOf = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0) / values.length;

const cvOf = (values: readonly number[]): number => {
  const centre = meanOf(values);
  return Math.sqrt(meanOf(values.map((value) => (value - centre) ** 2))) / centre;
};

/** Periodogram power of RR (as a function of beat time) at one frequency. */
const powerAt = (recording: Recording, frequencyHz: number): number => {
  const centre = meanOf(recording.rrMs);
  const [re, im] = recording.rrMs.reduce(
    ([sumRe, sumIm], rr, index) => {
      const angle = (2 * Math.PI * frequencyHz * recording.beatTimesMs[index + 1]) / 1000;
      return [
        sumRe + (rr - centre) * Math.cos(angle),
        sumIm + (rr - centre) * Math.sin(angle),
      ];
    },
    [0, 0],
  );
  return (re ** 2 + im ** 2) / recording.rrMs.length;
};

const bandPower = (recording: Recording, from: number, to: number): number => {
  const steps = 20;
  return meanOf(
    Array.from({ length: steps + 1 }, (_, i) =>
      powerAt(recording, from + ((to - from) * i) / steps),
    ),
  );
};

describe("simulateRecording is deterministic", () => {
  const config = { seed: 42, durationSec: 60, pacCount: 1, pvcCount: 1 } as const;

  test("sinus, seed 42, 60 s: fixed intervals, one PVC at 34, one PAC at 47", () => {
    const recording = simulateRecording({ ...config, rhythm: "sinus" });
    expect(recording.rrMs.length).toBe(65);
    expect(recording.rrMs.slice(0, 10)).toEqual([
      901, 917, 928, 926, 928, 921, 927, 931, 917, 922,
    ]);
    expect(recording.labels[34]).toBe("pvc");
    expect(recording.labels[47]).toBe("pac");
    expect(sha(recording)).toBe("7759cb8b4b27929c");
    expect(recording.pulseWave.values.length).toBe(1500);
  });

  test("persistent AF, seed 42, 60 s: fixed intervals", () => {
    const recording = simulateRecording({ seed: 42, durationSec: 60, rhythm: "af" });
    expect(recording.rrMs.length).toBe(99);
    expect(recording.rrMs.slice(0, 10)).toEqual([
      414, 627, 666, 593, 517, 522, 630, 697, 719, 631,
    ]);
    expect(sha(recording)).toBe("f29fd9fbeb317987");
  });

  test("paroxysmal AF shares the sinus stream before its episode", () => {
    const recording = simulateRecording({ ...config, rhythm: "paroxysmal_af" });
    expect(recording.rrMs.slice(0, 10)).toEqual([
      901, 917, 928, 926, 928, 921, 927, 931, 917, 922,
    ]);
    expect(sha(recording)).toBe("5c1da968f84f6420");
  });

  test("the same config twice gives equal recordings; another seed does not", () => {
    const input = {
      seed: 7,
      durationSec: 120,
      rhythm: "paroxysmal_af",
      pvcCount: 2,
    } as const;
    expect(simulateRecording(input)).toEqual(simulateRecording(input));
    expect(simulateRecording({ ...input, seed: 8 }).rrMs).not.toEqual(
      simulateRecording(input).rrMs,
    );
  });
});

describe("recording shape", () => {
  test("beat times are the running sum of RR and end within the duration", () => {
    const recording = simulateRecording({ seed: 3, durationSec: 30, rhythm: "af" });
    expect(recording.beatTimesMs).toEqual(beatTimesOf(recording.rrMs));
    expect(recording.beatTimesMs.length).toBe(recording.rrMs.length + 1);
    expect(recording.labels.length).toBe(recording.rrMs.length);
    expect((recording.beatTimesMs.at(-1) ?? 0) <= 30_000).toBe(true);
  });

  test("beatTimesOf: 800, 900 → 0, 800, 1700", () => {
    expect(beatTimesOf([800, 900])).toEqual([0, 800, 1700]);
  });

  test("meanHr is 60000 / mean RR", () => {
    const recording = simulateRecording({ seed: 5, durationSec: 60, rhythm: "sinus" });
    expect(recording.meanHr).toBeCloseTo(60_000 / meanOf(recording.rrMs), 9);
  });
});

describe("rhythm statistics over 20 seeds", () => {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);

  test("every AF recording varies more than every sinus recording (CV)", () => {
    const sinus = seeds.map((seed) =>
      cvOf(simulateRecording({ seed, durationSec: 300, rhythm: "sinus" }).rrMs),
    );
    const af = seeds.map((seed) =>
      cvOf(simulateRecording({ seed, durationSec: 300, rhythm: "af" }).rrMs),
    );
    expect(Math.max(...sinus) < Math.min(...af)).toBe(true);
    // Defaults: sinus SD 40 ms at 65 /min (CV ≈ 0.043), AF CV 0.2.
    expect(meanOf(sinus)).toBeCloseTo(0.043, 2);
    expect(meanOf(af)).toBeCloseTo(0.2, 1);
  });

  test("RSA: power at the respiratory rate (0.3 Hz) beats the empty band around 0.45 Hz", () => {
    const ratios = seeds.map((seed) => {
      const recording = simulateRecording({
        seed,
        durationSec: 300,
        rhythm: "sinus",
        respRateHz: 0.3,
      });
      return bandPower(recording, 0.28, 0.32) / bandPower(recording, 0.43, 0.47);
    });
    expect(Math.min(...ratios) > 10).toBe(true);
  });

  test("the LF peak follows lfHz: 0.08–0.12 Hz beats 0.18–0.22 Hz", () => {
    const recording = simulateRecording({ seed: 11, durationSec: 600, rhythm: "sinus" });
    expect(bandPower(recording, 0.08, 0.12) > 10 * bandPower(recording, 0.18, 0.22)).toBe(
      true,
    );
  });
});

describe("ectopic beats", () => {
  const base = { seed: 9, durationSec: 300, rhythm: "sinus" } as const;
  const plain = simulateRecording(base);
  const ectopic = simulateRecording({ ...base, pacCount: 4, pvcCount: 3 });

  test("the counts match the config", () => {
    expect(ectopic.labels.filter((label) => label === "pac").length).toBe(4);
    expect(ectopic.labels.filter((label) => label === "pvc").length).toBe(3);
    expect(plain.labels.filter((label) => label !== "sinus").length).toBe(0);
  });

  test("a PVC comes 25 % early and keeps the next beat in place (full compensatory pause)", () => {
    const sites = ectopic.labels.flatMap((label, i) => (label === "pvc" ? [i] : []));
    expect(sites.length).toBe(3);
    for (const i of sites) {
      expect(ectopic.rrMs[i]).toBe(Math.round(0.75 * plain.rrMs[i]));
      expect(ectopic.rrMs[i] + ectopic.rrMs[i + 1]).toBe(
        plain.rrMs[i] + plain.rrMs[i + 1],
      );
    }
  });

  test("a PAC comes 25 % early and the next interval is an ordinary sinus one", () => {
    const sites = ectopic.labels.flatMap((label, i) => (label === "pac" ? [i] : []));
    for (const i of sites) {
      expect(ectopic.rrMs[i]).toBe(Math.round(0.75 * plain.rrMs[i]));
      expect(ectopic.rrMs[i + 1]).toBe(plain.rrMs[i + 1]);
    }
  });

  test("no ectopic beat lands inside AF", () => {
    const recording = simulateRecording({
      seed: 4,
      durationSec: 120,
      rhythm: "paroxysmal_af",
      pacCount: 5,
      pvcCount: 5,
    });
    const starts = recording.beatTimesMs;
    recording.labels.forEach((label, i) => {
      if (label === "pac" || label === "pvc") {
        expect(starts[i + 1] < 40_000 || starts[i] >= 80_000).toBe(true);
      }
    });
  });

  test("more ectopic beats than a short recording can hold is an error", () => {
    expect(() =>
      simulateRecording({ seed: 1, durationSec: 30, rhythm: "sinus", pvcCount: 50 }),
    ).toThrow("ectopic beats");
  });
});

describe("paroxysmal AF", () => {
  test("default: AF over the middle third only", () => {
    const recording = simulateRecording({
      seed: 2,
      durationSec: 90,
      rhythm: "paroxysmal_af",
    });
    expect(recording.afEpisodes).toEqual([{ startSec: 30, endSec: 60 }]);
    recording.labels.forEach((label, i) => {
      const startSec = recording.beatTimesMs[i] / 1000;
      expect(label).toBe(startSec >= 30 && startSec < 60 ? "af" : "sinus");
    });
  });

  test("given episodes: two AF runs", () => {
    const recording = simulateRecording({
      seed: 2,
      durationSec: 120,
      rhythm: "paroxysmal_af",
      afEpisodes: [
        { startSec: 70, endSec: 100 },
        { startSec: 10, endSec: 30 },
      ],
    });
    const runs = recording.labels.reduce(
      (count, label, i) =>
        label === "af" && recording.labels[i - 1] !== "af" ? count + 1 : count,
      0,
    );
    expect(runs).toBe(2);
  });
});

describe("config bounds", () => {
  test("duration outside 30–600 s is refused", () => {
    expect(() =>
      simulateRecording({ seed: 1, durationSec: 20, rhythm: "sinus" }),
    ).toThrow();
    expect(() =>
      simulateRecording({ seed: 1, durationSec: 601, rhythm: "sinus" }),
    ).toThrow();
  });

  test("an unknown parameter is refused", () => {
    expect(() =>
      simulateRecording({ seed: 1, durationSec: 30, rhythm: "sinus", hr: 60 } as never),
    ).toThrow();
  });

  test("episodes for a non-paroxysmal rhythm, overlapping, or past the end are refused", () => {
    expect(() =>
      simulateRecording({
        seed: 1,
        durationSec: 60,
        rhythm: "af",
        afEpisodes: [{ startSec: 0, endSec: 10 }],
      }),
    ).toThrow("only for rhythm paroxysmal_af");
    expect(() =>
      simulateRecording({
        seed: 1,
        durationSec: 60,
        rhythm: "paroxysmal_af",
        afEpisodes: [
          { startSec: 0, endSec: 20 },
          { startSec: 10, endSec: 30 },
        ],
      }),
    ).toThrow("overlap");
    expect(() =>
      simulateRecording({
        seed: 1,
        durationSec: 60,
        rhythm: "paroxysmal_af",
        afEpisodes: [{ startSec: 50, endSec: 70 }],
      }),
    ).toThrow("ends after the recording");
  });
});
