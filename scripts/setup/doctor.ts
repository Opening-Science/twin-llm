/**
 * `bun run doctor`: a read-only report of what this machine has and what each
 * part of the app needs. Changes nothing; `bun run setup:local` fixes what it
 * can.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { detectState } from "./detect";
import {
  checkInstalledPackages,
  describeProblems,
  type PackageProblem,
} from "./installed-packages";
import {
  dataPageFindings,
  type DetectedState,
  databaseSummary,
  exampleSummary,
  type Finding,
  ollamaContextSummary,
  pageReadiness,
  type Readiness,
  SETUP_COMMAND,
  toolChecks,
} from "./plan";
import { TOOLS } from "./prerequisites";

const FINDING_MARK: Readonly<Record<Finding["mark"], string>> = {
  ok: "[ok]     ",
  no: "[no]     ",
  stale: "[stale]  ",
};

const readinessMark = (page: Readiness): string =>
  page.stale === true ? "[stale]  " : page.ready ? "[ready]  " : "[missing]";

/** The report as text. Pure. */
export const formatDoctor = (
  state: DetectedState,
  packages: readonly PackageProblem[] = [],
): string => {
  const tools = toolChecks(state).map((check) =>
    check.status === "ok"
      ? `  [ok]      ${TOOLS[check.id].label}${check.version ? ` ${check.version}` : ""}`
      : `  [missing] ${TOOLS[check.id].label} (${TOOLS[check.id].neededFor}): ${check.detail}. Install: ${check.fix}`,
  );
  const database = databaseSummary(state);
  const example = exampleSummary(state);
  const context = ollamaContextSummary(state.ollama);
  const openTwin =
    state.openTwin.synced === state.openTwin.pinned
      ? `  [ok]      open-twin packages at ${state.openTwin.pinned.slice(0, 7)}`
      : `  [missing] open-twin packages not at ${state.openTwin.pinned.slice(0, 7)}: bun run sync:open-twin`;
  const pages = pageReadiness(state).map(
    (page) => `  ${readinessMark(page)} ${page.page}: ${page.detail}`,
  );
  const open = pageReadiness(state).filter(
    (page) => !page.ready || page.stale === true,
  ).length;
  const dataPage = dataPageFindings(state).map(
    (finding) => `  ${FINDING_MARK[finding.mark]} ${finding.text}`,
  );
  return [
    `TwinLLM doctor (${state.platform}, read-only)`,
    "",
    "Programs",
    ...tools,
    "",
    "Project",
    `  ${state.envFile ? "[ok]     " : "[missing]"} .env.local${state.envFile ? ` (DATA_MODE=${state.dataMode ?? "unset"})` : `: ${SETUP_COMMAND} creates it`}`,
    `  ${database.ok ? "[ok]     " : "[missing]"} Postgres: ${database.detail}`,
    openTwin,
    packages.length === 0
      ? "  [ok]      node_modules matches package.json"
      : `  [stale]   node_modules: ${describeProblems(packages)}. Run: bun install`,
    `  ${example.ok ? "[ok]     " : "[off]    "} Example thread: ${example.detail}`,
    ...(context === null
      ? []
      : [
          `  ${context.ok ? "[ok]     " : "[no]     "} Ollama context: ${context.detail}`,
        ]),
    "",
    "What each page needs",
    ...pages,
    "",
    "Data page (/data): it lists a cohort only when neither the DATA_MODE line nor that cohort's line is [no]",
    ...dataPage,
    "",
    open === 0
      ? "Everything is ready."
      : `${open} item(s) not ready. ${SETUP_COMMAND} fixes what it can and says what to install.`,
    "",
  ].join("\n");
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  process.stdout.write(
    formatDoctor(await detectState(root), checkInstalledPackages(root)),
  );
}
