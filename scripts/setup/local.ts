/**
 * `bun run setup:local`: everything a fresh checkout needs to run like the
 * maintainers' machines, in one idempotent command (macOS and Linux).
 *
 *   bun run setup:local                  # synthetic eval cohort (pinned files from release eval-cohort-v1)
 *   bun run setup:local -- --cohort-10k  # the 10,000-person release instead (~1 GB download, ~45 GB disk)
 *   bun run setup:local -- --skip-cohort # everything but the cohort
 *   bun run setup:local -- --reload-cohort  # replace a stale eval cohort with the pinned one
 *   bun run setup:local -- --generate-cohort  # generate the eval cohort with Synthea instead (x86_64 matches the pin)
 *   bun run setup:local -- --skip-example     # do not add the "Example (synthetic)" thread
 *   bun run setup:local -- --skip-training-sample  # do not write the Training tab's sample set
 *
 * Checks prerequisites and prints how to install what is missing; it never
 * installs system packages. Steps already done are skipped, so it is safe to
 * re-run after fixing something. Ends with a checklist. `bun run doctor`
 * reports the same checks without changing anything.
 */
import { readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RIGGED_RELEASE_TAG } from "../../packages/anatomy/rigged-bodies";
import {
  loadEvalCohort,
  loadFixtures,
  loadRelease10k,
  reloadEvalCohort,
  runCommand,
  SetupBlocked,
  SetupError,
} from "./cohort-load";
import { currentPlatform, detectState, openSql } from "./detect";
import {
  databaseTarget,
  defaultDatabaseUrl,
  envFileFromExample,
  parseEnvFile,
  redactUrl,
} from "./env-file";
import {
  type Action,
  blockedBy,
  type CohortChoice,
  formatChecklist,
  GENERATE_FLAG,
  type Outcome,
  planSetup,
  type SetupOptions,
  SKIP_EXAMPLE_FLAG,
  SKIP_TRAINING_SAMPLE_FLAG,
  type Step,
} from "./plan";
import {
  insertExampleThread,
  parseExampleFixture,
  readExampleFixture,
} from "./example-thread";
import { checkTool } from "./prerequisites";

const USAGE =
  "Usage: bun run setup:local [-- --cohort-10k | --skip-cohort | [--reload-cohort] [--generate-cohort]] [--skip-example] [--skip-training-sample]";

const COHORT_FLAGS = ["--cohort-10k", "--skip-cohort", "--reload-cohort"];

/**
 * The options, or null for an unknown flag or flags that contradict each
 * other. `--generate-cohort` goes with the evaluation cohort only, alone or
 * with `--reload-cohort`.
 */
export const parseSetupArgs = (argv: readonly string[]): SetupOptions | null => {
  const known = argv.filter((arg) => arg !== "--");
  if (
    known.some(
      (arg) =>
        !COHORT_FLAGS.includes(arg) &&
        arg !== GENERATE_FLAG &&
        arg !== SKIP_EXAMPLE_FLAG &&
        arg !== SKIP_TRAINING_SAMPLE_FLAG,
    )
  )
    return null;
  const chosen = COHORT_FLAGS.filter((flag) => known.includes(flag));
  if (chosen.length > 1) return null;
  const cohort: CohortChoice = known.includes("--cohort-10k")
    ? "10k"
    : known.includes("--skip-cohort")
      ? "none"
      : "eval";
  const generateCohort = known.includes(GENERATE_FLAG);
  if (generateCohort && cohort !== "eval") return null;
  return {
    cohort,
    reloadCohort: known.includes("--reload-cohort"),
    generateCohort,
    skipExample: known.includes(SKIP_EXAMPLE_FLAG),
    skipTrainingSample: known.includes(SKIP_TRAINING_SAMPLE_FLAG),
  };
};

const createEnvFile = async (root: string): Promise<string> => {
  const example = await readFile(join(root, ".env.synthetic.example"), "utf8");
  const url = defaultDatabaseUrl(
    currentPlatform(),
    process.env.DATABASE_URL,
    userInfo().username,
  );
  // flag "wx": never overwrite a .env.local that appeared meanwhile.
  await writeFile(join(root, ".env.local"), envFileFromExample(example, url), {
    flag: "wx",
  });
  return `created from .env.synthetic.example, DATABASE_URL=${redactUrl(url)}`;
};

const createDatabase = async (name: string, databaseUrl: string): Promise<string> => {
  const target = databaseTarget(databaseUrl);
  if (target === null || target.name !== name)
    throw new SetupError(`cannot create ${name} from DATABASE_URL`);
  const sql = openSql(target.maintenanceUrl);
  try {
    // The name passed databaseTarget's plain-identifier check, so quoting it is safe.
    await sql.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await sql.close();
  }
  return `created database ${name}`;
};

const databaseUrl = async (root: string): Promise<string> => {
  const env = await readFile(join(root, ".env.local"), "utf8").catch(() => "");
  return process.env.DATABASE_URL ?? parseEnvFile(env).DATABASE_URL ?? "";
};

/** Download the rigged bodies from the release; bake them only when that fails. */
const installRigged = (
  root: string,
  action: Extract<Action, { kind: "install-rigged" }>,
): string => {
  if (
    runCommand(root, [
      "bun",
      "run",
      "anatomy:fetch",
      ...action.ids.flatMap((id) => ["--rigged", id]),
    ])
  ) {
    return `downloaded from release ${RIGGED_RELEASE_TAG}, SHA-256 as pinned`;
  }
  if (action.noBake !== null) throw new SetupBlocked(action.noBake);
  process.stdout.write("\nThe download did not work; baking locally instead.\n");
  if (
    runCommand(root, [
      "bun",
      "run",
      "anatomy:bake-rigged",
      ...action.ids.flatMap((id) => ["--demo", id]),
    ])
  ) {
    return `baked locally (the release download failed), SHA-256 as pinned`;
  }
  throw new SetupError(
    "neither the release download nor the local bake gave the pinned files; see the output above",
  );
};

/** Adds the example thread from the committed fixture; never calls a model. */
const addExampleThread = async (root: string, clerkId: string): Promise<string> => {
  const parsed = parseExampleFixture(await readExampleFixture(root));
  if (!parsed.ok)
    throw new SetupError(`the example fixture is not usable: ${parsed.why}`);
  const sql = openSql(await databaseUrl(root));
  try {
    const outcome = await insertExampleThread(sql, clerkId, parsed.fixture);
    switch (outcome.kind) {
      case "inserted":
        return `added to Your threads for LOCAL_USER_ID=${clerkId} (${parsed.fixture.response.modelName}, recorded ${parsed.fixture.recorded.date})`;
      case "exists":
        return "already in Your threads";
      case "refused":
        throw new SetupError(outcome.why);
    }
  } finally {
    await sql.close();
  }
};

const perform = async (root: string, action: Action): Promise<string> => {
  switch (action.kind) {
    case "create-env-file":
      return createEnvFile(root);
    case "create-database":
      return createDatabase(action.name, await databaseUrl(root));
    case "install-rigged":
      return installRigged(root, action);
    case "reload-eval":
      return reloadEvalCohort(
        root,
        await databaseUrl(root),
        action.source,
        action.fixtureSubjects !== undefined,
      );
    case "command":
      if (!runCommand(root, action.argv))
        throw new SetupError(`${action.argv.join(" ")} failed; see its output above`);
      return "done";
    case "load-eval":
      return loadEvalCohort(
        root,
        action.source,
        action.fixtureSubjects === undefined ? null : await databaseUrl(root),
      );
    case "load-10k":
      return loadRelease10k(root);
    case "load-fixtures":
      return loadFixtures(root);
    case "insert-example":
      return addExampleThread(root, action.clerkId);
  }
};

const NOT_RUN = {
  skip: "skipped",
  blocked: "blocked",
  off: "off",
  stale: "stale",
} as const;

const runStep = async (
  root: string,
  step: Step,
  earlier: readonly Outcome[],
): Promise<Outcome> => {
  const base = { id: step.id, title: step.title };
  if (step.status !== "run") {
    return { ...base, result: NOT_RUN[step.status], detail: step.reason };
  }
  const waiting = blockedBy(step, earlier);
  if (waiting !== null) return { ...base, result: "blocked", detail: waiting };
  process.stdout.write(`\n== ${step.title}${step.note ? ` (${step.note})` : ""}\n`);
  try {
    const detail = await perform(root, step.action);
    return { ...base, result: "done", detail };
  } catch (error) {
    if (error instanceof SetupBlocked)
      return { ...base, result: "blocked", detail: error.message };
    const detail =
      error instanceof SetupError
        ? error.message
        : "stopped with an error; see the output above";
    if (!(error instanceof SetupError)) console.error(error);
    return { ...base, result: "failed", detail };
  }
};

const main = async (): Promise<number> => {
  const options = parseSetupArgs(process.argv.slice(2));
  if (options === null) {
    console.error(USAGE);
    return 2;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const state = await detectState(root);

  const bun = checkTool("bun", state.tools.bun, state.platform);
  if (bun.status !== "ok") {
    console.error(`${bun.detail}. Install or upgrade: ${bun.fix}`);
    return 1;
  }
  const node = checkTool("node", state.tools.node, state.platform);
  if (node.status !== "ok") {
    process.stdout.write(`Note: ${node.detail}; next dev needs it: ${node.fix}\n`);
  }

  const steps = planSetup(state, options);
  process.stdout.write(`TwinLLM local setup (${state.platform})\n`);
  for (const step of steps) {
    const what =
      step.status === "run"
        ? `run${step.note ? `: ${step.note}` : ""}`
        : `${step.status}: ${step.reason}`;
    process.stdout.write(`  - ${step.title}: ${what}\n`);
  }

  const outcomes: Outcome[] = [];
  for (const step of steps) {
    outcomes.push(await runStep(root, step, outcomes));
  }
  const nodeOutcome: readonly Outcome[] =
    node.status === "ok"
      ? []
      : [
          {
            id: "install",
            title: "Node.js for next dev",
            result: "blocked",
            detail: `${node.detail}: ${node.fix}`,
          },
        ];
  process.stdout.write(formatChecklist([...outcomes, ...nodeOutcome]));
  process.stdout.write("Run bun run doctor any time for what each page needs.\n");
  return outcomes.some((outcome) => outcome.result === "failed") ? 1 : 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  process.exit(await main());
}
