/**
 * The rules of `training:batches`, with no I/O: which batches to run, where
 * each one's files go, which steps a batch still needs, and the guards that
 * keep the run off the dev database. `run-batches.ts` does the work.
 *
 * A 1M batch unpacks to about 41 GB of FHIR, so a batch is unpacked, turned
 * into conversations and removed before the next one starts. The conversation
 * manifest is written last by `training:conversations`, so it marks a batch
 * as done.
 */
import { join } from "node:path";

import { formatNumber } from "../../infrastructure/format-measure";
import {
  type BatchCohort,
  batchCohort,
  SYNTHEA_1M_BATCHES,
} from "../synthea/cohort-presets";

import { outputPaths } from "./build-conversations";

export const DEFAULT_ARCHIVES = "../synthea-1m/batches";
export const DEFAULT_WORK = ".synthea/batches";
export const DEFAULT_OUT = "training-data/out";
/** Read by the runner and by every step it starts; never `.env.local`. */
export const TRAINING_ENV_FILE = ".env.training";

export type BatchArgs = Readonly<{
  batches: readonly BatchCohort[];
  archives: string;
  work: string;
  out: string;
  keep: boolean;
  /** Go on past rejected FHIR bundles, leaving those subjects out. */
  skipRejected: boolean;
  /** With skipRejected: the largest share of a batch's bundles that may be left out. */
  maxRejectedShare: number;
}>;

/** More than this share of rejected bundles stops a batch even with --skip-rejected. */
export const DEFAULT_MAX_REJECTED_SHARE = 0.01;

const USAGE =
  "Usage: bun run training:batches -- --batches 1001-1010 [--archives <dir>] [--work <dir>] [--out <dir>] [--keep] [--skip-rejected [--max-rejected-share 0.01]]";

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const WHOLE = /^\d+$/;

/**
 * `1001-1010`, `1100` or `1001,1005-1007`, as batch seeds in order without
 * repeats; or a plain message saying what is wrong.
 */
export const parseBatchRange = (spec: string): readonly BatchCohort[] | string => {
  const { firstSeed, lastSeed } = SYNTHEA_1M_BATCHES;
  const seeds: number[] = [];
  for (const part of spec.split(",")) {
    const [fromText = "", toText = fromText, extra] = part.trim().split("-");
    if (extra !== undefined || !WHOLE.test(fromText) || !WHOLE.test(toText)) {
      return `--batches must look like 1001-1010 or 1001,1005 (got: ${spec}).`;
    }
    const from = Number(fromText);
    const to = Number(toText);
    if (from > to) return `--batches range ${part.trim()} runs backwards.`;
    if (from < firstSeed || to > lastSeed) {
      return `--batches are seeds ${firstSeed} to ${lastSeed} (got: ${part.trim()}).`;
    }
    seeds.push(...Array.from({ length: to - from + 1 }, (_, index) => from + index));
  }
  return [...new Set(seeds)]
    .sort((a, b) => a - b)
    .map(batchCohort)
    .filter((batch) => batch !== null);
};

/** The parsed flags, or a plain message saying what is wrong. */
export const parseBatchArgs = (argv: readonly string[]): BatchArgs | string => {
  const spec = flag(argv, "--batches");
  if (!spec) return USAGE;
  const batches = parseBatchRange(spec);
  if (typeof batches === "string") return batches;
  for (const name of ["--archives", "--work", "--out"]) {
    const value = flag(argv, name);
    if (argv.includes(name) && (!value || value.startsWith("--"))) {
      return `${name} needs a directory.`;
    }
  }
  const skipRejected = argv.includes("--skip-rejected");
  const shareText = flag(argv, "--max-rejected-share");
  if (argv.includes("--max-rejected-share")) {
    if (!skipRejected) return "--max-rejected-share needs --skip-rejected.";
    const share = Number(shareText);
    if (shareText === undefined || !/^\d*\.?\d+$/.test(shareText) || share > 1) {
      return `--max-rejected-share must be a share from 0 to 1, like 0.02 (got: ${shareText ?? ""}).`;
    }
  }
  return {
    batches,
    archives: flag(argv, "--archives") ?? DEFAULT_ARCHIVES,
    work: flag(argv, "--work") ?? DEFAULT_WORK,
    out: flag(argv, "--out") ?? DEFAULT_OUT,
    keep: argv.includes("--keep"),
    skipRejected,
    maxRejectedShare:
      shareText === undefined ? DEFAULT_MAX_REJECTED_SHARE : Number(shareText),
  };
};

export type BatchPaths = Readonly<{
  archive: string;
  archiveManifest: string;
  dir: string;
  fhir: string;
  wearables: string;
  manifest: string;
  unpacked: string;
  records: string;
  meta: string;
  conversationManifest: string;
  rejected: string;
  logs: string;
}>;

/**
 * Where one batch's files live. The fhir dir and its `manifest.json` sit side
 * by side, as `synthea:generate` writes them, so `wearables:generate` finds the
 * seed and `warehouse:ingest` the cohort id.
 */
export const batchPaths = (
  batch: BatchCohort,
  args: Pick<BatchArgs, "archives" | "work" | "out">,
): BatchPaths => {
  const dir = join(args.work, batch.cohortId);
  const out = outputPaths(join(args.out, `${batch.cohortId}.jsonl`));
  return {
    archive: join(args.archives, batch.archive),
    archiveManifest: join(
      args.archives,
      batch.archive.replace(/\.tar\.zst$/, ".manifest.json"),
    ),
    dir,
    fhir: join(dir, "fhir"),
    wearables: join(dir, "wearables"),
    manifest: join(dir, "manifest.json"),
    unpacked: join(dir, ".unpacked"),
    records: out.records,
    meta: out.meta,
    conversationManifest: out.manifest,
    rejected: join(args.out, `${batch.cohortId}.rejected.json`),
    logs: join(args.work, "logs"),
  };
};

export const STEPS = [
  "unpack",
  "wearables",
  "ingest fhir",
  "ingest wearables",
  "conversations",
  "clear rows",
  "remove files",
] as const;

export type Step = (typeof STEPS)[number];

export type BatchState = Readonly<{
  /** The conversation manifest exists: the batch is done. */
  done: boolean;
  /** A kept, fully unpacked copy is in the work dir. */
  unpacked: boolean;
  keep: boolean;
}>;

/**
 * The steps a batch still needs. A finished batch only gets its leftovers
 * cleared (rows and files from a run that stopped after the conversations),
 * which costs nothing when there are none. Ingest is safe to repeat: known
 * bundles are skipped by sha256.
 */
export const stepPlan = (state: BatchState): readonly Step[] =>
  STEPS.filter((step) => {
    if (step === "remove files") return !state.keep;
    if (step === "clear rows") return true;
    if (state.done) return false;
    if (step === "unpack") return !state.unpacked;
    return true;
  });

/** The batch manifest written next to the fhir dir, with the cohort id added. */
export const workManifest = (
  batch: BatchCohort,
  archived: unknown,
): Readonly<Record<string, unknown>> | string => {
  if (typeof archived !== "object" || archived === null) {
    return `No batch manifest for seed ${batch.seed}.`;
  }
  const seed = Reflect.get(archived, "seed");
  const clinicianSeed = Reflect.get(archived, "clinicianSeed");
  const population = Reflect.get(archived, "population");
  if (
    seed !== batch.seed ||
    clinicianSeed !== batch.clinicianSeed ||
    population !== batch.population
  ) {
    return `The batch manifest for ${batch.archive} does not match seed ${batch.seed}, clinician seed ${batch.clinicianSeed}, N=${batch.population}.`;
  }
  return { ...archived, cohortId: batch.cohortId };
};

/** The value of `key` in a dotenv file's text, or null. */
export const envFileValue = (text: string, key: string): string | null => {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${key}=`));
  if (line === undefined) return null;
  const value = line.slice(key.length + 1).trim();
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? (quoted[2] ?? "") : value;
};

/** The database name in a postgres URL, or null when it has none. */
export const databaseNameOf = (url: string): string | null => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name === "" ? null : name;
  } catch {
    return null;
  }
};

/**
 * Why the run must not use this database, or null when it may. `devUrls` are
 * the DATABASE_URLs of `.env.local` and `.env.synthetic.example`: the dev
 * database, whose Demo reads every allowlisted cohort.
 */
export const databaseRefusal = (
  url: string,
  devUrls: readonly (string | null)[],
): string | null => {
  const name = databaseNameOf(url);
  if (name === null) return "DATABASE_URL in .env.training names no database.";
  const devNames = devUrls
    .filter((dev) => dev !== null)
    .map(databaseNameOf)
    .filter((dev) => dev !== null);
  return devNames.includes(name)
    ? `Refused: ${name} is the dev database. Point DATABASE_URL in .env.training at a database for training cohorts only.`
    : null;
};

/** `Bundles: 3 inserted, 1 already ingested, 0 rejected` from warehouse:ingest. */
export const ingestCounts = (
  stdout: string,
): Readonly<{ inserted: number; already: number; rejected: number }> | null => {
  const match = /Bundles: (\d+) inserted, (\d+) already ingested, (\d+) rejected/.exec(
    stdout,
  );
  return match
    ? {
        inserted: Number(match[1]),
        already: Number(match[2]),
        rejected: Number(match[3]),
      }
    : null;
};

/** One `<file>: rejected (<reason>)` line of warehouse:ingest. */
export type RejectedBundle = Readonly<{ file: string; reason: string }>;

export const rejectedBundles = (stdout: string): readonly RejectedBundle[] =>
  [...stdout.matchAll(/^(.+\.json): rejected \(([^)]+)\)$/gm)].map((match) => ({
    file: match[1] ?? "",
    reason: match[2] ?? "",
  }));

/** Rejected bundles per reason code, sorted by code. */
export const reasonCounts = (
  rejected: readonly Readonly<{ reason: string }>[],
): Readonly<Record<string, number>> =>
  Object.fromEntries(
    [...new Set(rejected.map((bundle) => bundle.reason))]
      .sort()
      .map((reason) => [
        reason,
        rejected.filter((bundle) => bundle.reason === reason).length,
      ]),
  );

/**
 * Why a batch with rejected bundles must stop, or null when --skip-rejected
 * may leave them out. The share guard keeps a new kind of failure from
 * quietly dropping many people.
 */
export const rejectionRefusal = (
  counts: Readonly<{ inserted: number; already: number; rejected: number }>,
  args: Pick<BatchArgs, "skipRejected" | "maxRejectedShare">,
): string | null => {
  if (counts.rejected === 0) return null;
  if (!args.skipRejected) return "pass --skip-rejected to leave them out";
  const total = counts.inserted + counts.already + counts.rejected;
  return counts.rejected / total > args.maxRejectedShare
    ? `more than ${formatNumber(args.maxRejectedShare * 100, 1)}% of ${total} bundles; check the log, or raise --max-rejected-share`
    : null;
};

/** `<out>/<cohort>.rejected.json`: who was left out of a batch, and why. */
export type RejectedRecord = Readonly<{
  cohort_id: string;
  bundles: number;
  rejected: number;
  reasons: Readonly<Record<string, number>>;
  subjects: ReadonlyArray<
    Readonly<{ subject_ref: string | null; file: string; reasons: readonly string[] }>
  >;
}>;

export const rejectedRecord = (
  cohortId: string,
  bundles: number,
  rejected: ReadonlyArray<RejectedBundle & Readonly<{ subjectRef: string | null }>>,
): RejectedRecord => ({
  cohort_id: cohortId,
  bundles,
  rejected: rejected.length,
  reasons: reasonCounts(rejected),
  subjects: [...rejected]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((bundle) => ({
      subject_ref: bundle.subjectRef,
      file: bundle.file,
      reasons: [bundle.reason],
    })),
});

/** The wearable bundle files `wearables:generate` wrote for these subjects. */
export const wearableFilesFor = (
  wearablesDir: string,
  subjectRefs: readonly (string | null)[],
): readonly string[] =>
  subjectRefs
    .filter((ref) => ref !== null)
    .map((ref) => join(wearablesDir, `${ref}.wearables.json`));

/** `a.json: rejected (ot-unit-policy)` lines, as `2 ot-unit-policy, 1 ingest-failed`. */
export const rejectedReasons = (stdout: string): string =>
  reasonsText(reasonCounts(rejectedBundles(stdout)));

/** `{a: 1, b: 2}` as `2 b, 1 a`: most first, then by code. */
export const reasonsText = (reasons: Readonly<Record<string, number>>): string =>
  Object.entries(reasons)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, n]) => `${n} ${reason}`)
    .join(", ");

/** `Subjects: 9, ...` and `Readings: 4500 ...` from wearables:generate. */
export const wearableCounts = (
  stdout: string,
): Readonly<{ subjects: number; readings: number }> | null => {
  const subjects = /Subjects: (\d+)/.exec(stdout);
  const readings = /Readings: (\d+)/.exec(stdout);
  return subjects && readings
    ? { subjects: Number(subjects[1]), readings: Number(readings[1]) }
    : null;
};

/** `1h 02m 05s`, `3m 07s` or `12s`. */
export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
};

/** Decimal units, one decimal: `41.2 GB`. */
export const formatBytes = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const power = Math.min(
    units.length - 1,
    Math.max(0, Math.floor(Math.log10(Math.max(bytes, 1)) / 3)),
  );
  return `${formatNumber(bytes / 1000 ** power, power === 0 ? 0 : 1)} ${units[power]}`;
};
