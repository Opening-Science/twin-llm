/**
 * From what `detect.ts` found on this machine to what `setup:local` will do
 * and what `doctor` reports. Pure: no I/O, so every branch is unit tested.
 */
import { DEMO_BODY_IDS, type DemoBodyId } from "../../packages/anatomy/demo-bodies";
import { RIGGED_BODIES, RIGGED_RELEASE_TAG } from "../../packages/anatomy/rigged-bodies";
import {
  DEMO_COHORTS,
  isAllowedCohort,
  SYNTHETIC_COHORTS,
} from "../../packages/query-tools/scope";
import { EVAL_COHORT, EVAL_RELEASE, FIXTURE_COHORT, RELEASE_10K } from "./cohort-pins";
import {
  checkTool,
  type Platform,
  pgvectorInstall,
  POSTGRES_INSTALL,
  TOOL_IDS,
  type ToolCheck,
  type ToolId,
  type ToolProbe,
} from "./prerequisites";

/** One cohort id in the warehouse's `subjects` table, allowlisted or not. */
export type CohortRows = Readonly<{
  cohortId: string;
  /** Subjects marked `is_synthetic`, the only ones any page reads. */
  synthetic: number;
  total: number;
  /** At least one observation row belongs to this cohort's subjects. */
  hasObservations: boolean;
}>;

/** The bundles ingested under one cohort id: how many, and their fingerprint (cohort-fingerprint.ts). */
export type BundleSet = Readonly<{ count: number; sha256: string }>;

export type DatabaseProbe =
  | Readonly<{ kind: "no-url" }>
  | Readonly<{ kind: "placeholder" }>
  | Readonly<{ kind: "unreachable"; detail: string }>
  | Readonly<{ kind: "auth-failed" }>
  | Readonly<{
      kind: "missing-database";
      name: string;
      pgvector: boolean;
      serverMajor: number | null;
    }>
  | Readonly<{
      kind: "ok";
      pgvector: boolean;
      serverMajor: number | null;
      /** Applied migration names; empty when the database is new. */
      appliedMigrations: readonly string[];
      /** Every cohort in the warehouse; empty when the table is missing. */
      warehouse: readonly CohortRows[];
      /** The evaluation cohort's ingested bundles; null when it has none. */
      evalBundles: BundleSet | null;
      /** The local user already has the "Example (synthetic)" thread. */
      exampleThread: boolean;
    }>;

export type OllamaProbe =
  | Readonly<{ kind: "not-used"; provider: string }>
  | Readonly<{ kind: "unreachable"; baseUrl: string }>
  | Readonly<{ kind: "ok"; baseUrl: string; models: readonly string[] }>;

export type DetectedState = Readonly<{
  platform: Platform;
  tools: Readonly<Record<ToolId, ToolProbe>>;
  /** `.env.local` exists (setup creates it from the example when it does not). */
  envFile: boolean;
  dataMode: string | null;
  /** LOCAL_MVP or AUTH_DISABLED is on, so there is one local user. */
  authOff: boolean;
  /** LOCAL_USER_ID, the local user's `clerkId` (default "local"). */
  localUserId: string;
  database: DatabaseProbe;
  /** Migration folders in `prisma/migrations`. */
  migrations: readonly string[];
  openTwin: Readonly<{ pinned: string; synced: string | null }>;
  /** Atlas and demo-body files not yet installed (by file name). */
  anatomyMissing: readonly string[];
  /** Rigged demo bodies not yet installed (by file name). */
  riggedMissing: readonly string[];
  ollama: OllamaProbe;
  freeDiskBytes: number | null;
}>;

export type CohortChoice = "eval" | "10k" | "none";

export type SetupOptions = Readonly<{
  cohort: CohortChoice;
  /** `--reload-cohort`: replace the evaluation cohort's warehouse rows with the pinned cohort. */
  reloadCohort?: boolean;
  /** `--generate-cohort`: generate the evaluation cohort with Synthea instead of downloading it. */
  generateCohort?: boolean;
  /** `--skip-example`: do not add the example thread. */
  skipExample?: boolean;
}>;

/**
 * Where the evaluation cohort comes from. `download`: the pinned release
 * archive, with local generation as the fallback when the release cannot be
 * reached (`noGenerate` says why there is no fallback, or is null).
 * `generate`: Synthea on this machine, which matches the pin only on the CPU
 * architecture it was made on.
 */
export type EvalSource =
  | Readonly<{ kind: "download"; noGenerate: string | null }>
  | Readonly<{ kind: "generate" }>;

export type StepId =
  | "env-file"
  | "open-twin"
  | "install"
  | "database"
  | "migrate"
  | "anatomy"
  | "rigged"
  | "cohort"
  | "example";

/**
 * The trimmed fixtures are three people of the evaluation cohort (#96), and a
 * subject belongs to one cohort only, so ingesting the evaluation cohort over
 * them would reject those three bundles. A load or reload of the evaluation
 * cohort therefore deletes the fixture cohort's rows first; this is how many
 * subjects it holds, and the field is left out when there are none.
 */
type FixturesReplaced = Readonly<{ fixtureSubjects?: number }>;

export type Action =
  | Readonly<{ kind: "create-env-file" }>
  | Readonly<{ kind: "command"; argv: readonly string[] }>
  | Readonly<{ kind: "create-database"; name: string }>
  | Readonly<{ kind: "load-eval"; source: EvalSource } & FixturesReplaced>
  | Readonly<
      {
        kind: "reload-eval";
        cohortId: string;
        subjects: number;
        source: EvalSource;
      } & FixturesReplaced
    >
  | Readonly<{ kind: "load-10k" }>
  | Readonly<{ kind: "load-fixtures" }>
  | Readonly<{ kind: "insert-example"; clerkId: string }>
  | Readonly<{
      kind: "install-rigged";
      ids: readonly DemoBodyId[];
      /** Why there is no bake fallback (uv missing), or null when there is one. */
      noBake: string | null;
    }>;

export type Step = Readonly<{
  id: StepId;
  title: string;
  /** Steps that must have succeeded (or been skipped as already done) first. */
  after: readonly StepId[];
}> &
  (
    | Readonly<{ status: "run"; action: Action; note?: string }>
    | Readonly<{ status: "skip" | "blocked" | "off" | "stale"; reason: string }>
  );

export const SETUP_COMMAND = "bun run setup:local";
export const RELOAD_COMMAND = "bun run setup:local -- --reload-cohort";
export const GENERATE_FLAG = "--generate-cohort";
export const SKIP_EXAMPLE_FLAG = "--skip-example";
export const EXAMPLE_TITLE = "Example (synthetic)";

const fixFor = (state: DetectedState, id: ToolId): string | null => {
  const check = checkTool(id, state.tools[id], state.platform);
  return check.status === "ok" ? null : `${check.detail}: ${check.fix}`;
};

/** Synthetic subjects in the allowlisted cohorts, by cohort. */
const loadedCohorts = (database: DatabaseProbe): Readonly<Record<string, number>> =>
  database.kind === "ok"
    ? Object.fromEntries(
        database.warehouse
          .filter((rows) => isAllowedCohort(rows.cohortId) && rows.synthetic > 0)
          .map((rows) => [rows.cohortId, rows.synthetic]),
      )
    : {};

export type EvalCohortState =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "current"; subjects: number }>
  | Readonly<{ kind: "stale"; subjects: number; why: string }>;

/**
 * Whether the warehouse's evaluation cohort is the pinned one: the subject
 * count, and the ingested bundles' fingerprint when the database has bundles.
 * A cohort ingested before the dates were fixed has the same id but other
 * people (35 subjects instead of 37).
 */
export const evalCohortState = (database: DatabaseProbe): EvalCohortState => {
  if (database.kind !== "ok") return { kind: "absent" };
  const subjects =
    database.warehouse.find((rows) => rows.cohortId === EVAL_COHORT.cohortId)?.total ?? 0;
  if (subjects === 0) return { kind: "absent" };
  const problems = [
    subjects === EVAL_COHORT.subjectCount
      ? null
      : `${subjects} subjects, the pinned cohort has ${EVAL_COHORT.subjectCount}`,
    database.evalBundles === null ||
    database.evalBundles.sha256 === EVAL_COHORT.bundleSetSha256
      ? null
      : `its ${database.evalBundles.count} ingested bundles are not the pinned files`,
  ].filter((problem) => problem !== null);
  return problems.length === 0
    ? { kind: "current", subjects }
    : { kind: "stale", subjects, why: problems.join("; ") };
};

const staleReason = (why: string): string =>
  `${EVAL_COHORT.cohortId} in the warehouse is an older copy (${why}). Fix: ${RELOAD_COMMAND} (replaces this cohort's warehouse rows and nothing else)`;

const totalSubjects = (cohorts: Readonly<Record<string, number>>): number =>
  Object.values(cohorts).reduce((sum, n) => sum + n, 0);

const databaseProblem = (state: DetectedState): string | null => {
  const db = state.database;
  switch (db.kind) {
    case "no-url":
      return "DATABASE_URL is not set in .env.local";
    case "placeholder":
      return "DATABASE_URL in .env.local is still the example placeholder; set it to your Postgres (e.g. postgresql://postgres:postgres@127.0.0.1:5432/twin_llm_synthetic) and re-run";
    case "auth-failed":
      return "Postgres refused the user or password in DATABASE_URL";
    case "unreachable":
      return `Postgres is not reachable at DATABASE_URL (${db.detail}): ${POSTGRES_INSTALL[state.platform]}`;
    case "missing-database":
    case "ok":
      return db.pgvector
        ? null
        : `pgvector is not installed in this Postgres: ${pgvectorInstall(state.platform, db.serverMajor)}`;
  }
};

const openTwinStep = (state: DetectedState): Step => {
  const base = {
    id: "open-twin",
    title: "open-twin packages (sync:open-twin)",
    after: [],
  } as const;
  if (state.openTwin.synced === state.openTwin.pinned) {
    return {
      ...base,
      status: "skip",
      reason: `already at ${state.openTwin.pinned.slice(0, 7)}`,
    };
  }
  const missing = (["git", "python3"] as const)
    .map((id) => fixFor(state, id))
    .filter((fix) => fix !== null);
  return missing.length > 0
    ? { ...base, status: "blocked", reason: missing.join("; ") }
    : {
        ...base,
        status: "run",
        action: { kind: "command", argv: ["bun", "run", "sync:open-twin"] },
      };
};

const databaseStep = (state: DetectedState): Step => {
  const base = {
    id: "database",
    title: "Postgres database",
    after: ["env-file"],
  } as const;
  const problem = databaseProblem(state);
  if (problem !== null) return { ...base, status: "blocked", reason: problem };
  return state.database.kind === "missing-database"
    ? {
        ...base,
        status: "run",
        action: { kind: "create-database", name: state.database.name },
      }
    : { ...base, status: "skip", reason: "reachable, pgvector available" };
};

const anatomyStep = (state: DetectedState): Step => {
  const base = {
    id: "anatomy",
    title: "Anatomy atlases and demo bodies (anatomy:fetch)",
    after: [],
  } as const;
  return state.anatomyMissing.length === 0
    ? { ...base, status: "skip", reason: "all installed" }
    : {
        ...base,
        status: "run",
        action: {
          kind: "command",
          argv: ["bun", "run", "anatomy:fetch", "--skip-rigged"],
        },
        note: `${state.anatomyMissing.length} file(s) to download`,
      };
};

/** Demo bodies whose rigged file is missing, from the file names detect reports. */
const missingRiggedIds = (state: DetectedState): readonly DemoBodyId[] =>
  DEMO_BODY_IDS.filter((id) => state.riggedMissing.includes(RIGGED_BODIES[id].fileName));

const riggedStep = (state: DetectedState): Step => {
  const base = {
    id: "rigged",
    title: "Rigged demo bodies for Walk/Idle/Dance (anatomy:fetch, bake as fallback)",
    after: [],
  } as const;
  const ids = missingRiggedIds(state);
  if (ids.length === 0) return { ...base, status: "skip", reason: "both installed" };
  const uv = fixFor(state, "uv");
  return {
    ...base,
    status: "run",
    action: {
      kind: "install-rigged",
      ids,
      noBake:
        uv === null
          ? null
          : `the download failed and the bake fallback needs uv (${uv}). Then run ${SETUP_COMMAND} again. The demo bodies stay static until then.`,
    },
    note:
      uv === null
        ? `download from release ${RIGGED_RELEASE_TAG}; bake locally only if that fails`
        : `download from release ${RIGGED_RELEASE_TAG} (no uv, so no bake fallback)`,
  };
};

const cohortStep = (state: DetectedState, options: SetupOptions): Step => {
  const base = {
    id: "cohort",
    title: "Synthetic cohort in the warehouse",
    after: ["migrate"],
  } as const;
  if (options.cohort === "none")
    return { ...base, status: "off", reason: "not loaded (--skip-cohort)" };
  const cohorts = loadedCohorts(state.database);
  if (options.cohort === "10k") {
    const have = cohorts[RELEASE_10K.cohortId] ?? 0;
    if (have > 0)
      return {
        ...base,
        status: "skip",
        reason: `${RELEASE_10K.cohortId} already has ${have} subjects`,
      };
    const zstd = fixFor(state, "zstd");
    if (zstd !== null) return { ...base, status: "blocked", reason: zstd };
    if (
      state.freeDiskBytes !== null &&
      state.freeDiskBytes < RELEASE_10K.diskBytesNeeded
    ) {
      return {
        ...base,
        status: "blocked",
        reason: `the 10k cohort needs about ${gigabytes(RELEASE_10K.diskBytesNeeded)} free here, ${gigabytes(state.freeDiskBytes)} available`,
      };
    }
    return {
      ...base,
      status: "run",
      action: { kind: "load-10k" },
      note: `download ${gigabytes(RELEASE_10K.archiveBytes)} from release ${RELEASE_10K.tag}, verify, unpack, ingest as ${RELEASE_10K.cohortId}`,
    };
  }
  const evalState = evalCohortState(state.database);
  const source = evalSource(state, options);
  const fixtureSubjects = cohorts[FIXTURE_COHORT.cohortId] ?? 0;
  const fixtures =
    fixtureSubjects > 0
      ? {
          field: { fixtureSubjects },
          note: `; first delete the ${fixtureSubjects} subjects of ${FIXTURE_COHORT.cohortId}, who are also in ${EVAL_COHORT.cohortId}`,
        }
      : { field: {}, note: "" };
  if (options.reloadCohort === true) {
    if (source.kind === "none") {
      return {
        ...base,
        status: "blocked",
        reason: `${source.reason}. --reload-cohort loads ${EVAL_COHORT.cohortId} first; nothing was deleted.`,
      };
    }
    return evalState.kind === "absent"
      ? {
          ...base,
          status: "run",
          action: { kind: "load-eval", source: source.source, ...fixtures.field },
          note: `${EVAL_COHORT.cohortId} is not loaded, so nothing to delete: ${source.note}${fixtures.note}, ingest`,
        }
      : {
          ...base,
          status: "run",
          action: {
            kind: "reload-eval",
            cohortId: EVAL_COHORT.cohortId,
            subjects: evalState.subjects,
            source: source.source,
            ...fixtures.field,
          },
          note: `${source.note}${fixtures.note}; then delete its ${evalState.subjects} subjects' warehouse rows in one transaction and ingest the pinned cohort`,
        };
  }
  if (evalState.kind === "stale") {
    return { ...base, status: "stale", reason: staleReason(evalState.why) };
  }
  const loaded = Object.entries(cohorts).filter(
    ([id, n]) => n > 0 && id !== FIXTURE_COHORT.cohortId,
  );
  if (loaded.length > 0) {
    return {
      ...base,
      status: "skip",
      reason: `warehouse already has ${loaded.map(([id, n]) => `${id} (${n} subjects)`).join(", ")}`,
    };
  }
  if (source.kind !== "none") {
    return {
      ...base,
      status: "run",
      action: { kind: "load-eval", source: source.source, ...fixtures.field },
      note: `${source.note}${fixtures.note}, ingest`,
    };
  }
  const reason = `${source.reason}. Then run ${SETUP_COMMAND} again to load ${EVAL_COHORT.cohortId}.`;
  return totalSubjects(cohorts) === 0 && options.generateCohort !== true
    ? {
        ...base,
        status: "run",
        action: { kind: "load-fixtures" },
        note: `cannot download or generate the eval cohort here, so only the three trimmed fixtures (${FIXTURE_COHORT.cohortId}). ${reason}`,
      }
    : { ...base, status: "blocked", reason };
};

/**
 * The example thread: added for the local user when auth is off and the app
 * runs on synthetic data, once. It is never added with personal data on.
 */
const exampleStep = (state: DetectedState, skip: boolean): Step => {
  const base = {
    id: "example",
    title: `Example thread "${EXAMPLE_TITLE}"`,
    after: ["migrate"],
  } as const;
  if (skip) return { ...base, status: "off", reason: `not added (${SKIP_EXAMPLE_FLAG})` };
  if (!state.authOff)
    return {
      ...base,
      status: "off",
      reason: "auth is on (no LOCAL_MVP or AUTH_DISABLED), so there is no local user",
    };
  if (state.dataMode !== "synthetic")
    return {
      ...base,
      status: "off",
      reason: `only with DATA_MODE=synthetic (now ${state.dataMode ?? "unset"})`,
    };
  if (databaseProblem(state) !== null)
    return { ...base, status: "blocked", reason: "needs the database" };
  if (state.database.kind === "ok" && state.database.exampleThread)
    return {
      ...base,
      status: "skip",
      reason: `already in Your threads for LOCAL_USER_ID=${state.localUserId}`,
    };
  return {
    ...base,
    status: "run",
    action: { kind: "insert-example", clerkId: state.localUserId },
    note: `from scripts/setup/fixtures/example-thread.json, for LOCAL_USER_ID=${state.localUserId}`,
  };
};

type SourceChoice =
  | Readonly<{ kind: "ok"; source: EvalSource; note: string }>
  | Readonly<{ kind: "none"; reason: string }>;

/**
 * How this machine can get the evaluation cohort: the download needs zstd to
 * unpack, generating needs Java, curl and shasum. Downloading is the default
 * because only it gives the pinned files on every CPU architecture.
 */
const evalSource = (state: DetectedState, options: SetupOptions): SourceChoice => {
  const generateFix = [
    fixFor(state, "java"),
    fixFor(state, "curl"),
    fixFor(state, "shasum"),
  ].filter((fix) => fix !== null);
  const zstdFix = fixFor(state, "zstd");
  const generated = `generate ${EVAL_COHORT.cohortId} with Synthea (fixed seed and dates), verify`;
  if (options.generateCohort === true) {
    return generateFix.length === 0
      ? {
          kind: "ok",
          source: { kind: "generate" },
          note: `${GENERATE_FLAG}: ${generated}`,
        }
      : {
          kind: "none",
          reason: `${generateFix.join("; ")}. ${GENERATE_FLAG} needs Java; without the flag setup downloads the pinned files instead`,
        };
  }
  if (zstdFix === null) {
    const noGenerate = generateFix.length === 0 ? null : generateFix.join("; ");
    return {
      kind: "ok",
      source: { kind: "download", noGenerate },
      note: `download ${EVAL_RELEASE.archive} from release ${EVAL_RELEASE.tag}, verify (${noGenerate === null ? "Synthea generates it instead if the release cannot be reached" : "no Java, so no local fallback"})`,
    };
  }
  if (generateFix.length === 0) {
    return {
      kind: "ok",
      source: { kind: "generate" },
      note: `no zstd to unpack the release (${zstdFix}), so ${generated} (matches the pin on x86_64 only)`,
    };
  }
  return { kind: "none", reason: [zstdFix, ...generateFix].join("; ") };
};

const gigabytes = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;

/** Every step `setup:local` takes, in order, with what it will do and why. */
export const planSetup = (
  state: DetectedState,
  options: SetupOptions,
): readonly Step[] => {
  const envFile: Step = state.envFile
    ? {
        id: "env-file",
        title: ".env.local",
        after: [],
        status: "skip",
        reason: "present (left as it is)",
      }
    : {
        id: "env-file",
        title: ".env.local",
        after: [],
        status: "run",
        action: { kind: "create-env-file" },
        note: "copied from .env.synthetic.example (DATA_MODE=synthetic, LOCAL_ONLY=true)",
      };
  const install: Step = {
    id: "install",
    title: "Dependencies (bun install)",
    after: ["open-twin"],
    status: "run",
    action: { kind: "command", argv: ["bun", "install"] },
  };
  const database = databaseStep(state);
  const migrate: Step =
    database.status === "blocked"
      ? {
          id: "migrate",
          title: "Migrations (prisma migrate deploy)",
          after: ["database", "install"],
          status: "blocked",
          reason: "needs the database",
        }
      : {
          id: "migrate",
          title: "Migrations (prisma migrate deploy)",
          after: ["database", "install"],
          status: "run",
          action: { kind: "command", argv: ["bunx", "prisma", "migrate", "deploy"] },
        };
  const cohort: Step =
    database.status === "blocked" && options.cohort !== "none"
      ? {
          id: "cohort",
          title: "Synthetic cohort in the warehouse",
          after: ["migrate"],
          status: "blocked",
          reason: "needs the database",
        }
      : cohortStep(state, options);
  return [
    envFile,
    openTwinStep(state),
    install,
    database,
    migrate,
    anatomyStep(state),
    riggedStep(state),
    cohort,
    exampleStep(state, options.skipExample === true),
  ];
};

export type Outcome = Readonly<{
  id: StepId;
  title: string;
  /**
   * `off`: left out on request (--skip-cohort), so not something to fix.
   * `stale`: present but not the pinned version; the detail says how to fix it.
   */
  result: "done" | "skipped" | "off" | "stale" | "blocked" | "failed";
  detail: string;
}>;

/**
 * Whether a planned step can run given what happened before it: null when it
 * can, otherwise why not. A dependency that was skipped because it was already
 * done counts as done.
 */
export const blockedBy = (step: Step, earlier: readonly Outcome[]): string | null => {
  const failed = earlier.filter(
    (outcome) =>
      step.after.includes(outcome.id) &&
      (outcome.result === "failed" || outcome.result === "blocked"),
  );
  return failed.length === 0
    ? null
    : `needs ${failed.map((outcome) => outcome.title).join(", ")}`;
};

const MARK: Readonly<Record<Outcome["result"], string>> = {
  done: "[ready]  ",
  skipped: "[ready]  ",
  off: "[off]    ",
  stale: "[stale]  ",
  blocked: "[skipped]",
  failed: "[FAILED] ",
};

/** The final checklist: what is ready, what was skipped and why. */
export const formatChecklist = (outcomes: readonly Outcome[]): string => {
  const lines = outcomes.map(
    (outcome) => `${MARK[outcome.result]} ${outcome.title}: ${outcome.detail}`,
  );
  const open = outcomes.filter(
    (outcome) =>
      outcome.result === "blocked" ||
      outcome.result === "failed" ||
      outcome.result === "stale",
  );
  const tail =
    open.length === 0
      ? "Everything is ready. Start the app with: bun run dev"
      : `${open.length} item(s) need attention (above). Fix them and run ${SETUP_COMMAND} again; finished steps are skipped.`;
  return ["", "Setup checklist", ...lines, "", tail, ""].join("\n");
};

export type Readiness = Readonly<{
  page: string;
  ready: boolean;
  detail: string;
  /** Works, but on data that is not the pinned version (detail says how to fix it). */
  stale?: boolean;
}>;

const CHAT_MODELS_HINT = "ollama pull qwen3:8b && ollama pull nomic-embed-text";

/** What each part of the app needs on this machine, and whether it has it. */
export const pageReadiness = (state: DetectedState): readonly Readiness[] => {
  const cohorts = loadedCohorts(state.database);
  const loaded = SYNTHETIC_COHORTS.filter((id) => (cohorts[id] ?? 0) > 0);
  const demo = DEMO_COHORTS.filter((id) => (cohorts[id] ?? 0) > 0);
  const dbProblem = databaseProblem(state);
  const evalState = evalCohortState(state.database);
  const applied = state.database.kind === "ok" ? state.database.appliedMigrations : [];
  const pending = state.migrations.filter((name) => !applied.includes(name));
  const dataPage: Readiness =
    dbProblem !== null
      ? { page: "Data page (/data)", ready: false, detail: dbProblem }
      : pending.length > 0
        ? {
            page: "Data page (/data)",
            ready: false,
            detail: `${pending.length} migration(s) not applied: ${SETUP_COMMAND}`,
          }
        : loaded.length === 0
          ? {
              page: "Data page (/data)",
              ready: false,
              detail: `no synthetic cohort loaded: ${SETUP_COMMAND}`,
            }
          : evalState.kind === "stale"
            ? {
                page: "Data page (/data)",
                ready: true,
                stale: true,
                detail: staleReason(evalState.why),
              }
            : {
                page: "Data page (/data)",
                ready: true,
                detail: loaded.map((id) => `${id} (${cohorts[id]} subjects)`).join(", "),
              };
  const demoLabs: Readiness =
    demo.length > 0
      ? { page: "Body twin Demo lab values", ready: true, detail: demo.join(", ") }
      : {
          page: "Body twin Demo lab values",
          ready: false,
          detail: `needs ${DEMO_COHORTS.join(" or ")}: ${SETUP_COMMAND}`,
        };
  const anatomy: Readiness =
    state.anatomyMissing.length === 0
      ? {
          page: "Body twin anatomy and demo bodies",
          ready: true,
          detail: "all installed",
        }
      : {
          page: "Body twin anatomy and demo bodies",
          ready: false,
          detail: `missing ${state.anatomyMissing.join(", ")}: bun run anatomy:fetch`,
        };
  const uv = fixFor(state, "uv");
  const walking: Readiness =
    state.riggedMissing.length === 0
      ? {
          page: "Body twin Walk/Idle",
          ready: true,
          detail: "rigged demo bodies installed",
        }
      : {
          page: "Body twin Walk/Idle",
          ready: false,
          detail: `rigged bodies missing (${state.riggedMissing.join(", ")}): bun run anatomy:fetch downloads them from release ${RIGGED_RELEASE_TAG}; offline, bun run anatomy:bake-rigged${uv === null ? "" : ` after installing uv (${uv})`}`,
        };
  const chat = chatReadiness(state.ollama);
  return [dataPage, demoLabs, anatomy, walking, chat];
};

const isEmbedding = (model: string): boolean => /embed/i.test(model);

const chatReadiness = (ollama: OllamaProbe): Readiness => {
  const page = "Chat (local model)";
  switch (ollama.kind) {
    case "not-used":
      return {
        page,
        ready: true,
        detail: `LLM_PROVIDER=${ollama.provider}; not checked here`,
      };
    case "unreachable":
      return {
        page,
        ready: false,
        detail: `Ollama not answering at ${ollama.baseUrl}: start it (ollama serve), then ${CHAT_MODELS_HINT}`,
      };
    case "ok": {
      const chatModels = ollama.models.filter((model) => !isEmbedding(model));
      const embed = ollama.models.some((model) => model.startsWith("nomic-embed-text"));
      if (chatModels.length === 0)
        return {
          page,
          ready: false,
          detail: `no chat model pulled: ${CHAT_MODELS_HINT}`,
        };
      return embed
        ? { page, ready: true, detail: chatModels.join(", ") }
        : {
            page,
            ready: true,
            detail: `${chatModels.join(", ")}; knowledge search also needs: ollama pull nomic-embed-text`,
          };
    }
  }
};

/** Every prerequisite, as doctor lists it. */
export const toolChecks = (state: DetectedState): readonly ToolCheck[] =>
  TOOL_IDS.map((id) => checkTool(id, state.tools[id], state.platform));

/** The example thread line for doctor; not counted as something to fix. */
export const exampleSummary = (
  state: DetectedState,
): Readonly<{ ok: boolean; detail: string }> => {
  if (state.database.kind === "ok" && state.database.exampleThread)
    return {
      ok: true,
      detail: `"${EXAMPLE_TITLE}" in Your threads for LOCAL_USER_ID=${state.localUserId}`,
    };
  const step = exampleStep(state, false);
  return {
    ok: false,
    detail:
      step.status === "run"
        ? `"${EXAMPLE_TITLE}" not in Your threads: ${SETUP_COMMAND} adds it (${SKIP_EXAMPLE_FLAG} leaves it out)`
        : `"${EXAMPLE_TITLE}" not added: ${step.reason}`,
  };
};

/** The database line for doctor. */
export const databaseSummary = (
  state: DetectedState,
): Readonly<{ ok: boolean; detail: string }> => {
  const problem = databaseProblem(state);
  if (problem !== null) return { ok: false, detail: problem };
  if (state.database.kind === "missing-database") {
    return {
      ok: false,
      detail: `database ${state.database.name} does not exist yet: ${SETUP_COMMAND} creates it`,
    };
  }
  const total = totalSubjects(loadedCohorts(state.database));
  return {
    ok: true,
    detail: `reachable, pgvector available, ${total} synthetic subjects`,
  };
};

export type Finding = Readonly<{ mark: "ok" | "no" | "stale"; text: string }>;

/**
 * Why the Data page could be empty, one finding per condition it reads under:
 * DATA_MODE, a reachable database, and per cohort whether it is in
 * SYNTHETIC_COHORTS, has synthetic subjects and has observation rows.
 */
export const dataPageFindings = (state: DetectedState): readonly Finding[] => {
  const mode: Finding =
    state.dataMode === "synthetic"
      ? { mark: "ok", text: "DATA_MODE=synthetic" }
      : {
          mark: "no",
          text: `DATA_MODE=${state.dataMode ?? "unset"}: the page reads the warehouse only with DATA_MODE=synthetic (.env.local)`,
        };
  const problem = databaseProblem(state);
  if (problem !== null) return [mode, { mark: "no", text: problem }];
  if (state.database.kind !== "ok")
    return [mode, { mark: "no", text: databaseSummary(state).detail }];
  const { warehouse } = state.database;
  if (warehouse.length === 0)
    return [
      mode,
      {
        mark: "no",
        text: `the warehouse has no subjects: ${SETUP_COMMAND} loads ${EVAL_COHORT.cohortId}`,
      },
    ];
  const evalState = evalCohortState(state.database);
  const cohortFinding = (rows: CohortRows): Finding => {
    const name = `${rows.cohortId}: ${rows.synthetic} synthetic subject(s)`;
    if (!isAllowedCohort(rows.cohortId))
      return {
        mark: "no",
        text: `${rows.cohortId}: ${rows.total} subject(s), not in SYNTHETIC_COHORTS (packages/query-tools/scope.ts), so the page never lists it`,
      };
    if (rows.synthetic === 0)
      return {
        mark: "no",
        text: `${name} of ${rows.total}; only is_synthetic subjects are shown`,
      };
    if (!rows.hasObservations)
      return {
        mark: "no",
        text: `${name}, in SYNTHETIC_COHORTS, but no observation rows: ingest it again with ${SETUP_COMMAND}`,
      };
    if (rows.cohortId === EVAL_COHORT.cohortId && evalState.kind === "stale")
      return { mark: "stale", text: `${name}: ${staleReason(evalState.why)}` };
    return {
      mark: "ok",
      text: `${name}, in SYNTHETIC_COHORTS, observation rows present`,
    };
  };
  return [mode, ...warehouse.map(cohortFinding)];
};
