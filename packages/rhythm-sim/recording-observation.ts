/**
 * A simulated recording as one FHIR R4 Observation. The main value is the RR
 * tachogram as `valueSampledData`: SampledData needs a fixed period, so the
 * tachogram is the RR interval in progress at every 250 ms (4 Hz, no
 * interpolation), not one value per beat. Components carry the mean heart rate
 * (LOINC 8867-4), the 25 Hz pulse-wave proxy, and the simulator's ground-truth
 * label at the same 4 Hz, coded in `urn:twinllm:rhythm-sim` and named as
 * simulator metadata, never as a finding. Tagged as test data. Pure.
 */
import {
  codeableConcept,
  createObservation,
  LOINC_CODINGS,
  numericComponent,
  SYSTEMS,
  UCUM,
} from "@open-twin/fhir-core";
import type { Observation, SampledData } from "fhir/r4";

import { type BeatLabel } from "./ectopic-beats";
import { type Recording } from "./simulate-recording";

export const RHYTHM_SIM_SYSTEM = "urn:twinllm:rhythm-sim";
export const RHYTHM_SIM_GENERATOR = "twinllm-rhythm-sim";
/** Tachogram and ground-truth sampling period, ms (4 Hz). */
export const TACHOGRAM_PERIOD_MS = 250;

export const RHYTHM_SIM_CODES = {
  tachogram: {
    system: RHYTHM_SIM_SYSTEM,
    code: "rr-tachogram",
    display: "RR interval tachogram, simulated",
  },
  pulseWave: {
    system: RHYTHM_SIM_SYSTEM,
    code: "pulse-wave-proxy",
    display: "Pulse-wave proxy, simulated",
  },
  groundTruth: {
    system: RHYTHM_SIM_SYSTEM,
    code: "ground-truth-label",
    display:
      "Simulator ground truth (0 sinus, 1 AF, 2 PAC, 3 PVC); simulator metadata, not a finding",
  },
} as const;

/** The ground-truth component's numbers for each label. */
export const LABEL_CODES: Readonly<Record<BeatLabel, number>> = {
  sinus: 0,
  af: 1,
  pac: 2,
  pvc: 3,
};

export const RHYTHM_SIM_TAGS = [
  {
    system: "http://terminology.hl7.org/CodeSystem/v3-ActReason",
    code: "HTEST",
    display: "test health data",
  },
  { system: "urn:twinllm:generator", code: RHYTHM_SIM_GENERATOR },
] as const;

const UNITY = { unit: "1", system: SYSTEMS.UCUM, code: "1" } as const;

/**
 * For each 4 Hz sample time before the last beat, the index of the interval in
 * progress (the beat before it and the beat after it).
 */
export const intervalIndexAtSamples = (
  beatTimesMs: readonly number[],
  periodMs: number,
): number[] => {
  const last = beatTimesMs.at(-1) ?? 0;
  const count = Math.ceil(last / periodMs);
  const indices: number[] = [];
  let interval = 0;
  for (let sample = 0; sample < count; sample += 1) {
    const tMs = sample * periodMs;
    while (interval + 1 < beatTimesMs.length - 1 && beatTimesMs[interval + 1] <= tMs) {
      interval += 1;
    }
    indices.push(interval);
  }
  return indices;
};

const sampled = (
  data: readonly number[],
  periodMs: number,
  origin: SampledData["origin"],
  factor?: number,
): SampledData => ({
  origin,
  period: periodMs,
  ...(factor === undefined ? {} : { factor }),
  dimensions: 1,
  data: data.join(" "),
});

export type ObservationContext = Readonly<{
  /** e.g. `Patient/…` or `urn:uuid:…`. */
  subjectReference: string;
  /** When the recording starts, ISO-8601 UTC; the simulator has no clock. */
  start: string;
  id?: string;
}>;

export const recordingObservation = (
  recording: Recording,
  context: ObservationContext,
): Observation => {
  const startMs = Date.parse(context.start);
  const endMs = startMs + recording.config.durationSec * 1000;
  const indices = intervalIndexAtSamples(recording.beatTimesMs, TACHOGRAM_PERIOD_MS);
  const pulsePeriodMs = 1000 / recording.pulseWave.sampleRateHz;
  const base = createObservation({
    id: context.id,
    code: RHYTHM_SIM_CODES.tachogram,
    codeText: RHYTHM_SIM_CODES.tachogram.display,
    subject: { reference: context.subjectReference },
    effectivePeriod: {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    },
    components: [
      numericComponent(
        LOINC_CODINGS.HEART_RATE,
        Math.round(recording.meanHr * 10) / 10,
        UCUM.PER_MINUTE,
      ),
      {
        code: codeableConcept(RHYTHM_SIM_CODES.pulseWave),
        valueSampledData: sampled(
          recording.pulseWave.values.map((value) => Math.round(value * 1000)),
          pulsePeriodMs,
          { value: 0, ...UNITY },
          0.001,
        ),
      },
      {
        code: codeableConcept(RHYTHM_SIM_CODES.groundTruth),
        valueSampledData: sampled(
          indices.map((index) => LABEL_CODES[recording.labels[index]]),
          TACHOGRAM_PERIOD_MS,
          { value: 0, ...UNITY },
        ),
      },
    ],
    note: "Simulated recording from a statistical model of RR intervals, not a measurement of a person. The ground-truth component is simulator metadata.",
    meta: { tag: RHYTHM_SIM_TAGS.map((tag) => ({ ...tag })) },
  });
  return {
    ...base,
    valueSampledData: sampled(
      indices.map((index) => recording.rrMs[index]),
      TACHOGRAM_PERIOD_MS,
      { value: 0, unit: "ms", system: SYSTEMS.UCUM, code: UCUM.MILLISECOND.code },
    ),
  };
};
