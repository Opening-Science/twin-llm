import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
import { dataMode } from "@/infrastructure/data-mode";
import { type ToolRefusal } from "@/packages/query-tools/refusals";
import {
  AF_SNOMED_CODE,
  recordingConfigFor,
  rhythmGroundTruth,
} from "@/packages/query-tools/rhythm-recording";
import { runLabRhythmRecording } from "@/packages/query-tools/rhythm-tools";
import { recordingObservation } from "@/packages/rhythm-sim/recording-observation";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import { type Evidence, type EvidenceTable } from "./lab-check";
import {
  parseSimulationForm,
  type SearchParams,
  SIMULATION_COHORT,
  type SimulationForm,
} from "./simulation-request";
import {
  type ChartPoint,
  flaggedSpans,
  intervalCsv,
  metricsSummary,
  pulseStrip,
  recordingFileStem,
  recordingTitle,
  refusalSentence,
  simulatorSettings,
  type Span,
  tachogramPoints,
  thresholdTable,
  windowCsv,
  windowTable,
} from "./simulation-view";

/**
 * The I/O half of the Simulations section: lists the pinned cohort's
 * synthetic people, and for a submitted form runs `runLabRhythmRecording`
 * (the `rhythm_irregularity` plan and metrics, audited) and makes the same
 * recording again to draw it. Synthetic mode only; in personal mode nothing
 * is read.
 */

/** A cohort is a few hundred people; the list never grows past this. */
const SUBJECT_LIST_CAP = 500;

export type SubjectOption = Readonly<{ ref: string; label: string }>;

export type MadeRecording = Readonly<{
  title: string;
  subjectLabel: string;
  durationSec: number;
  tachogram: readonly ChartPoint[];
  flagged: readonly Span[];
  pulse: readonly ChartPoint[];
  pulseSeconds: number;
  summary: readonly Evidence[] | null;
  windows: EvidenceTable | null;
  windowsCsv: string | null;
  intervalsCsv: string;
  /** Why there are no metrics, when the tool refused this recording. */
  metricsNote: string | null;
  thresholds: EvidenceTable;
  settings: readonly Evidence[];
  observationJson: string;
  fileStem: string;
}>;

export type SimulationOutcome =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "refused"; sentence: string }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "made"; recording: MadeRecording }>;

export type SimulationData =
  | Readonly<{ kind: "personal" }>
  | Readonly<{
      kind: "synthetic";
      subjects: readonly SubjectOption[];
      form: SimulationForm;
      outcome: SimulationOutcome;
    }>;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const listSubjects = async (): Promise<readonly SubjectOption[]> => {
  const client = database();
  const where = { isSynthetic: true, cohortId: SIMULATION_COHORT } as const;
  const [subjects, withAf] = await Promise.all([
    client.subject.findMany({
      where,
      select: { subjectRef: true },
      orderBy: { subjectRef: "asc" },
      take: SUBJECT_LIST_CAP,
    }),
    client.condition.findMany({
      where: { code: AF_SNOMED_CODE, subject: where },
      select: { subjectRef: true },
      distinct: ["subjectRef"],
      take: SUBJECT_LIST_CAP,
    }),
  ]);
  const af = new Set(withAf.map((row) => row.subjectRef));
  return subjects.map((subject, index) => ({
    ref: subject.subjectRef,
    label: `Synthetic person ${index + 1} · ${subject.subjectRef.slice(0, 8)}${
      af.has(subject.subjectRef) ? " · record lists atrial fibrillation" : ""
    }`,
  }));
};

const isRefusal = (value: object): value is ToolRefusal => "code" in value;

const makeRecording = async (
  form: SimulationForm,
  subjects: readonly SubjectOption[],
): Promise<SimulationOutcome> => {
  const request = form.request;
  if (request === null) return { kind: "none" };
  const subject = subjects.find((each) => each.ref === request.subjectRef);
  if (subject === undefined) {
    return { kind: "refused", sentence: "Choose a person from the list." };
  }
  const actor = await resolveActorId();
  if (actor === null)
    return { kind: "refused", sentence: "Sign in to make a recording." };
  const result = await runLabRhythmRecording(
    { actor, sessionId: "lab", mode: "synthetic" },
    {
      subject_ref: request.subjectRef,
      recording: request.recording,
      duration_sec: request.durationSec,
      ...(request.date === null ? {} : { date: request.date }),
    },
  );
  if (isRefusal(result)) return { kind: "refused", sentence: refusalSentence(result) };
  const { plan, metrics } = result;
  const recording = simulateRecording(recordingConfigFor(plan));
  const spans = flaggedSpans(metrics);
  const observation = recordingObservation(recording, {
    subjectReference: `Patient/${plan.subjectRef}`,
    start: `${plan.date}T00:00:00.000Z`,
    id: `rhythm-sim-${plan.date}-${plan.recording}`,
  });
  const described = "windows" in metrics ? metrics : null;
  const pulse = pulseStrip(recording);
  return {
    kind: "made",
    recording: {
      title: recordingTitle(plan),
      subjectLabel: subject.label,
      durationSec: plan.durationSec,
      tachogram: tachogramPoints(recording),
      flagged: spans,
      pulse,
      pulseSeconds: (pulse.at(-1)?.t ?? 0) + 1 / recording.pulseWave.sampleRateHz,
      summary: described === null ? null : metricsSummary(described),
      windows: described === null ? null : windowTable(described),
      windowsCsv: described === null ? null : windowCsv(described),
      intervalsCsv: intervalCsv(recording, spans),
      metricsNote: isRefusal(metrics) ? refusalSentence(metrics) : null,
      thresholds: thresholdTable(),
      settings: simulatorSettings(plan, recording, rhythmGroundTruth(plan)),
      observationJson: JSON.stringify(observation, null, 2),
      fileStem: recordingFileStem(plan),
    },
  };
};

export const loadSimulation = async (params: SearchParams): Promise<SimulationData> => {
  if (dataMode() !== "synthetic") return { kind: "personal" };
  const form = parseSimulationForm(params);
  try {
    const subjects = await listSubjects();
    return {
      kind: "synthetic",
      subjects,
      form,
      outcome: await makeRecording(form, subjects).catch((error: unknown) => {
        console.error("[lab] simulated recording failed", errorName(error));
        return { kind: "failed" } as const;
      }),
    };
  } catch (error) {
    console.error("[lab] synthetic subjects could not be read", errorName(error));
    return { kind: "synthetic", subjects: [], form, outcome: { kind: "failed" } };
  }
};
