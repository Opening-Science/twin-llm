/**
 * Part B of the attribution study (pre-registration sections 3 to 5, #508):
 * exclusions, per-participant indices and the two registered contrasts, from
 * participants' responses. Pure. `simulateParticipants` makes seeded fake
 * responses so the analysis can be written and run before any real data are
 * opened, as the registration's blinding section asks.
 *
 * Exclusions, applied before any outcome is computed and in this order:
 * a failed attention check; a completion time under a third of the pilot
 * median; the same detection answer on all 16 trials; a panel id seen before
 * (the first attempt is kept).
 *
 * Per participant: d′ and criterion c from the detection trials (a hit is a
 * mis-attributed answer flagged, a false alarm a correct one flagged; the
 * log-linear correction, `detection`); the calibration gap, mean trust on
 * validated measures minus mean trust on limited or no-evidence measures,
 * over correctly attributed answers; the share of trials with the data panel
 * opened.
 *
 * Contrasts: U1, d′ in D1 against D0; U2, the calibration gap in D2 against
 * D1; both by Welch's t-test, Holm over the two at 0.05, supported only in
 * the predicted direction (higher in the later arm).
 */
import { normal, randomFor } from "../../../infrastructure/seeded-random";
import type { EvidenceLevel } from "../../../features/wearables/accuracy/types";
import { detection, holm, type HolmResult, type Welch, welch } from "./analysis";

export const PART_B_ARMS = ["D0", "D1", "D2"] as const;
export type PartBArm = (typeof PART_B_ARMS)[number];

export type TrialResponse = Readonly<{
  trialId: string;
  kind: "detection" | "calibration";
  truth: "correct" | "wrong_source" | "wrong_day";
  evidence: EvidenceLevel;
  /** "Does this number match where the answer says it comes from?" answered no; null on calibration trials. */
  flagged: boolean | null;
  /** 1 to 7. */
  trust: number;
  panelOpened: boolean;
}>;

export type Participant = Readonly<{
  id: string;
  panelId: string;
  arm: PartBArm;
  seconds: number;
  attentionPassed: readonly boolean[];
  responses: readonly TrialResponse[];
}>;

export const EXCLUSION_REASONS = [
  "attention",
  "too_fast",
  "same_answer",
  "duplicate_panel_id",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type Exclusions = Readonly<{
  kept: readonly Participant[];
  excluded: readonly Readonly<{ id: string; reason: ExclusionReason }>[];
}>;

/** The registered exclusions, in order; reads no outcome index. */
export const applyExclusions = (
  participants: readonly Participant[],
  pilotMedianSeconds: number,
): Exclusions => {
  const seen = new Set<string>();
  const kept: Participant[] = [];
  const excluded: { id: string; reason: ExclusionReason }[] = [];
  for (const participant of participants) {
    const flags = participant.responses
      .filter((response) => response.kind === "detection")
      .map((response) => response.flagged);
    const reason: ExclusionReason | null = !participant.attentionPassed.every(Boolean)
      ? "attention"
      : participant.seconds < pilotMedianSeconds / 3
        ? "too_fast"
        : flags.length > 0 && flags.every((flag) => flag === flags[0])
          ? "same_answer"
          : seen.has(participant.panelId)
            ? "duplicate_panel_id"
            : null;
    seen.add(participant.panelId);
    if (reason === null) kept.push(participant);
    else excluded.push({ id: participant.id, reason });
  }
  return { kept, excluded };
};

export type Indices = Readonly<{
  id: string;
  arm: PartBArm;
  dPrime: number;
  criterion: number;
  /** Null when the participant rated no correct answer on one side of the contrast. */
  calibrationGap: number | null;
  panelUse: number;
}>;

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export const indicesOf = (participant: Participant): Indices => {
  const trials = participant.responses.filter(
    (response) => response.kind === "detection",
  );
  const wrong = trials.filter((response) => response.truth !== "correct");
  const right = trials.filter((response) => response.truth === "correct");
  const { dPrime, criterion } = detection({
    hits: wrong.filter((response) => response.flagged === true).length,
    signal: wrong.length,
    falseAlarms: right.filter((response) => response.flagged === true).length,
    noise: right.length,
  });
  const correct = participant.responses.filter(
    (response) => response.truth === "correct",
  );
  const validated = mean(
    correct.filter((r) => r.evidence === "validated").map((r) => r.trust),
  );
  const weaker = mean(
    correct.filter((r) => r.evidence !== "validated").map((r) => r.trust),
  );
  return {
    id: participant.id,
    arm: participant.arm,
    dPrime,
    criterion,
    calibrationGap: validated === null || weaker === null ? null : validated - weaker,
    panelUse:
      participant.responses.length === 0
        ? 0
        : participant.responses.filter((response) => response.panelOpened).length /
          participant.responses.length,
  };
};

export type PartB = Readonly<{
  exclusions: Exclusions;
  perArm: Readonly<Record<PartBArm, number>>;
  u1: Welch | null;
  u2: Welch | null;
  holm: Readonly<Record<string, HolmResult>>;
}>;

const ofArm = (indices: readonly Indices[], arm: PartBArm) =>
  indices.filter((index) => index.arm === arm);

const tryWelch = (a: readonly number[], b: readonly number[]): Welch | null =>
  a.length < 2 || b.length < 2 ? null : welch(a, b);

export const partB = (
  participants: readonly Participant[],
  pilotMedianSeconds: number,
): PartB => {
  const exclusions = applyExclusions(participants, pilotMedianSeconds);
  const indices = exclusions.kept.map(indicesOf);
  const gaps = (arm: PartBArm) =>
    ofArm(indices, arm).flatMap((index) =>
      index.calibrationGap === null ? [] : [index.calibrationGap],
    );
  const u1 = tryWelch(
    ofArm(indices, "D0").map((index) => index.dPrime),
    ofArm(indices, "D1").map((index) => index.dPrime),
  );
  const u2 = tryWelch(gaps("D1"), gaps("D2"));
  return {
    exclusions,
    perArm: {
      D0: ofArm(indices, "D0").length,
      D1: ofArm(indices, "D1").length,
      D2: ofArm(indices, "D2").length,
    },
    u1,
    u2,
    holm: holm({ U1: u1?.p ?? null, U2: u2?.p ?? null }),
  };
};

const fixed = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "–" : value.toFixed(digits);

const pValue = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "–"
    : value < 0.001
      ? "< 0.001"
      : value.toFixed(3);

export const partBMarkdown = (result: PartB, note: string): string => {
  const row = (name: string, test: Welch | null) => {
    const holmed = result.holm[name];
    const supported = holmed?.reject === true && (test?.difference ?? 0) > 0;
    return `| ${name} | ${fixed(test?.difference)} | ${fixed(test?.t)} | ${fixed(test?.df, 1)} | ${pValue(test?.p)} | ${holmed === undefined ? "–" : `${pValue(holmed.adjusted)} (${supported ? "supported" : "not supported"})`} |`;
  };
  const reasons = EXCLUSION_REASONS.map(
    (reason) =>
      `${reason} ${result.exclusions.excluded.filter((entry) => entry.reason === reason).length}`,
  ).join(", ");
  return [
    "# Attribution study, Part B",
    "",
    note,
    "",
    `Analysable: D0 ${result.perArm.D0}, D1 ${result.perArm.D1}, D2 ${result.perArm.D2}. Excluded: ${reasons}.`,
    "",
    "| Contrast | Difference | t | df | p | Holm-adjusted |",
    "| --- | --- | --- | --- | --- | --- |",
    row("U1", result.u1),
    row("U2", result.u2),
    "",
    "U1: d′, D1 − D0. U2: calibration gap (trust on validated minus limited or no evidence), D2 − D1. Welch's t-test, two-sided.",
    "",
  ].join("\n");
};

export type Simulation = Readonly<{
  perArm: number;
  /** Mean d′ per arm. */
  dPrime: Readonly<Record<PartBArm, number>>;
  /** Mean trust gap (validated minus none) per arm, in scale points. */
  gap: Readonly<Record<PartBArm, number>>;
  /** Share who fail an attention check, are too fast, or answer the same throughout. */
  careless: number;
}>;

export const SIMULATION_DEFAULTS: Simulation = {
  perArm: 103,
  dPrime: { D0: 0.8, D1: 1.3, D2: 1.3 },
  gap: { D0: 0.2, D1: 0.3, D2: 0.9 },
  careless: 0.12,
};

const clampTrust = (value: number) => Math.min(7, Math.max(1, Math.round(value)));

/**
 * Fake participants with known effects, seeded. Each responds by a simple
 * signal-detection model with the arm's d′ and an unbiased criterion; trust
 * is 4 plus half the arm's gap on validated measures, minus half on the
 * rest, with noise. For writing and checking the analysis only.
 */
export const simulateParticipants = (
  seed: number,
  simulation: Simulation = SIMULATION_DEFAULTS,
): readonly Participant[] => {
  const random = randomFor(seed, "part-b");
  const trials: readonly Omit<TrialResponse, "flagged" | "trust" | "panelOpened">[] = [
    ...Array.from({ length: 16 }, (_, index) => ({
      trialId: `detection-${index + 1}`,
      kind: "detection" as const,
      truth: (index < 8 ? "correct" : index < 12 ? "wrong_source" : "wrong_day") as
        "correct" | "wrong_source" | "wrong_day",
      evidence: (index % 2 === 0 ? "validated" : "none") as EvidenceLevel,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      trialId: `calibration-${index + 1}`,
      kind: "calibration" as const,
      truth: "correct" as const,
      evidence: (index < 3 ? "validated" : "none") as EvidenceLevel,
    })),
  ];
  return PART_B_ARMS.flatMap((arm) =>
    Array.from({ length: simulation.perArm }, (_, index): Participant => {
      const careless = random() < simulation.careless;
      const d = simulation.dPrime[arm] + 0.5 * normal(random);
      const gap = simulation.gap[arm] + 0.8 * normal(random);
      const responses = trials.map((trial): TrialResponse => {
        const signal = trial.truth !== "correct";
        const evidence = (signal ? d / 2 : -d / 2) + normal(random);
        return {
          ...trial,
          flagged: trial.kind === "detection" ? (careless ? true : evidence > 0) : null,
          trust: clampTrust(
            4 + (trial.evidence === "validated" ? gap / 2 : -gap / 2) + normal(random),
          ),
          panelOpened: random() < (arm === "D0" ? 0.5 : 0.3),
        };
      });
      return {
        id: `sim-${arm}-${String(index + 1).padStart(3, "0")}`,
        panelId: `panel-${arm}-${index + 1}`,
        arm,
        seconds: careless ? 200 : 900 + 300 * normal(random),
        attentionPassed: [true, !careless || random() < 0.5],
        responses,
      };
    }),
  );
};
