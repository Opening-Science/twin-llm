import { type StatusTone } from "@/infrastructure/ui-kit/status-badge";

import { type CheckStatus } from "./lab-check";
import { type JobState } from "./lab-jobs";

/**
 * The Lab hub (`/lab`): one card per experiment, each opening its own page.
 * This module only decides the words and the tone of each card from what the
 * loaders found; the page draws them. Order is the order a newcomer meets
 * them: what runs here, what you can make, what has been measured, who
 * rates it.
 */

export type LabPart =
  "checks" | "simulations" | "evaluations" | "benchmark" | "jobs" | "rate";

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

export type LabHubInput = Readonly<{
  checks: readonly CheckStatus[];
  /** Synthetic people the simulator can use; null in personal mode. */
  simulationSubjects: number | null;
  runs: Readonly<{ count: number; more: boolean; failed: boolean }>;
  benchmark: Readonly<{ found: boolean; runs: number }>;
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

export const checksMeta = (
  checks: readonly CheckStatus[],
): Readonly<{ meta: string; tone: StatusTone }> => {
  if (checks.length === 0) return { meta: "No checks ran", tone: "off" };
  const of = (status: CheckStatus) => checks.filter((each) => each === status).length;
  const notOk = of("not-ok");
  return {
    meta: `${String(of("ok"))} OK · ${String(notOk)} Not OK · ${String(of("unknown"))} Unknown`,
    tone: notOk > 0 ? "warn" : of("unknown") > 0 ? "neutral" : "ok",
  };
};

const simulationsMeta = (subjects: number | null) =>
  subjects === null
    ? { meta: "Synthetic mode only", tone: "off" as const }
    : subjects === 0
      ? { meta: "No synthetic people loaded", tone: "off" as const }
      : {
          meta: `${count(subjects, "synthetic person", "synthetic people")}`,
          tone: "neutral" as const,
        };

const runsMeta = (runs: LabHubInput["runs"]) =>
  runs.failed
    ? { meta: "Runs folder could not be read", tone: "warn" as const }
    : runs.count === 0
      ? { meta: "Not run yet", tone: "off" as const }
      : {
          meta: `${runs.more ? "Newest " : ""}${count(runs.count, "run")}`,
          tone: "neutral" as const,
        };

const benchmarkMeta = (benchmark: LabHubInput["benchmark"]) =>
  benchmark.found
    ? {
        meta: benchmark.runs > 1 ? `Newest of ${count(benchmark.runs, "run")}` : "1 run",
        tone: "neutral" as const,
      }
    : { meta: "Not run yet", tone: "off" as const };

const jobsMeta = (jobs: readonly JobState[]) => {
  const running = jobs.filter((state) => state === "working").length;
  return running > 0
    ? { meta: `${count(running, "job")} running`, tone: "ok" as const }
    : { meta: "Nothing running", tone: "neutral" as const };
};

export const labHubCards = (input: LabHubInput): readonly LabHubCard[] => {
  const metas: Readonly<Record<LabPart, Readonly<{ meta: string; tone: StatusTone }>>> = {
    checks: checksMeta(input.checks),
    simulations: simulationsMeta(input.simulationSubjects),
    evaluations: runsMeta(input.runs),
    benchmark: benchmarkMeta(input.benchmark),
    jobs: jobsMeta(input.jobs),
    rate: { meta: "Question sets hb and v1h", tone: "neutral" },
  };
  return (Object.keys(LAB_PATH) as LabPart[]).map((part) => ({
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
