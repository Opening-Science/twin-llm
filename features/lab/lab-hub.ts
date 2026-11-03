import { type StatusTone } from "@/infrastructure/ui-kit/status-badge";

import { type JobState } from "./lab-jobs";
import { RATED_SETS } from "./rater-rubric";

/**
 * The Lab hub (`/lab`): one card per experiment, each opening its own page.
 * This module only decides the words and the tone of each card from what the
 * loaders counted; the page draws them. The hub runs no check and parses no
 * file: each meta line costs a readdir, a stat or one database count, so the
 * page everyone passes through stays cheap. No server-only import belongs
 * here; the search items read the titles and paths too.
 */

export type LabPart =
  "checks" | "simulations" | "evaluations" | "benchmark" | "jobs" | "rate";

/** The hub's order: what runs here, what you can make, what has been measured, who rates it. */
export const LAB_PARTS: readonly LabPart[] = [
  "checks",
  "simulations",
  "evaluations",
  "benchmark",
  "jobs",
  "rate",
];

export const LAB_PATH: Readonly<Record<LabPart, string>> = {
  checks: "/lab/checks",
  simulations: "/lab/simulations",
  evaluations: "/lab/evaluations",
  benchmark: "/lab/benchmark",
  jobs: "/lab/jobs",
  rate: "/lab/rate",
};

export const LAB_TITLE: Readonly<Record<LabPart, string>> = {
  checks: "Verifiability",
  simulations: "Heart rhythm simulations",
  evaluations: "Evaluation runs",
  benchmark: "Rhythm benchmark",
  jobs: "Long jobs",
  rate: "Second rating",
};

/** What each part is, in one line: the card's line and the detail page's lead. */
export const LAB_LINE: Readonly<Record<LabPart, string>> = {
  checks: "Check what runs on this machine, each with a command that repeats it by hand.",
  simulations:
    "Make a simulated heart rhythm recording of a synthetic person and see the research metrics.",
  evaluations:
    "Pass rates per model and scenario from the evaluation runs on this machine.",
  benchmark:
    "How the research flag and rhythm metrics do on simulated and database recordings.",
  jobs: "The last run of each command-line job, read from the files it writes.",
  rate: "Rate answers blind, one at a time, next to the automatic scorer.",
};

/** Synthetic people the simulator can use; "personal" in personal mode, "unread" when the database did not answer. */
export type SubjectCount = number | "personal" | "unread";

export type LabHubInput = Readonly<{
  /** How many checks `/lab/checks` runs; the hub only counts them. */
  checkCount: number;
  simulationSubjects: SubjectCount;
  /** Run folders found; `failed` when the folder could not be listed. */
  runs: Readonly<{ count: number; failed: boolean }>;
  /** Benchmark run folders with a result file. */
  benchmarkRuns: number;
  jobs: readonly JobState[];
}>;

export type LabHubCard = Readonly<{
  part: LabPart;
  href: string;
  title: string;
  line: string;
  meta: string;
  tone: StatusTone;
}>;

const count = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** The checks are counted, never run, on the hub; their page runs them. */
export const checksMeta = (
  checkCount: number,
): Readonly<{ meta: string; tone: StatusTone }> => ({
  meta: count(checkCount, "check"),
  tone: "neutral",
});

const simulationsMeta = (subjects: SubjectCount) =>
  subjects === "personal"
    ? { meta: "Synthetic mode only", tone: "off" as const }
    : subjects === "unread"
      ? { meta: "Synthetic people could not be counted", tone: "warn" as const }
      : subjects === 0
        ? { meta: "No synthetic people loaded", tone: "off" as const }
        : {
            meta: count(subjects, "synthetic person", "synthetic people"),
            tone: "neutral" as const,
          };

const runsMeta = (runs: LabHubInput["runs"]) =>
  runs.failed
    ? { meta: "Runs folder could not be read", tone: "warn" as const }
    : runs.count === 0
      ? { meta: "Not run yet", tone: "off" as const }
      : { meta: count(runs.count, "run"), tone: "neutral" as const };

const benchmarkMeta = (runs: number) =>
  runs === 0
    ? { meta: "Not run yet", tone: "off" as const }
    : { meta: count(runs, "run"), tone: "neutral" as const };

const jobsMeta = (jobs: readonly JobState[]) => {
  const running = jobs.filter((state) => state === "working").length;
  return running > 0
    ? { meta: `${count(running, "job")} running`, tone: "ok" as const }
    : { meta: "Nothing running", tone: "neutral" as const };
};

export const labHubCards = (input: LabHubInput): readonly LabHubCard[] => {
  const metas: Readonly<Record<LabPart, Readonly<{ meta: string; tone: StatusTone }>>> = {
    checks: checksMeta(input.checkCount),
    simulations: simulationsMeta(input.simulationSubjects),
    evaluations: runsMeta(input.runs),
    benchmark: benchmarkMeta(input.benchmarkRuns),
    jobs: jobsMeta(input.jobs),
    rate: {
      meta: `Question sets ${RATED_SETS.join(" and ")}`,
      tone: "neutral",
    },
  };
  return LAB_PARTS.map((part) => ({
    part,
    href: LAB_PATH[part],
    title: LAB_TITLE[part],
    line: LAB_LINE[part],
    ...metas[part],
  }));
};

/** Old `/lab?subject=…` links made a recording on the single Lab page; they now go to its own page. */
export const legacySimulationHref = (
  params: Readonly<Record<string, string | string[] | undefined>>,
): string | null => {
  const keys = ["subject", "date", "seconds", "recording"] as const;
  const kept = keys.flatMap((key) => {
    const value = params[key];
    return typeof value === "string" ? [[key, value]] : [];
  });
  if (kept.length === 0) return null;
  return `${LAB_PATH.simulations}?${new URLSearchParams(kept).toString()}`;
};
