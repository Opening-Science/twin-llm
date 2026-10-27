import { describe, expect, test } from "bun:test";

import { EVAL_COHORT } from "./cohort-pins";
import {
  blockedBy,
  type BundleSet,
  type CohortRows,
  dataPageFindings,
  type DatabaseProbe,
  type DetectedState,
  evalCohortState,
  exampleSummary,
  formatChecklist,
  type Outcome,
  pageReadiness,
  planSetup,
  type SetupOptions,
  type Step,
} from "./plan";
import { TOOL_IDS, type ToolId, type ToolProbe } from "./prerequisites";

const PIN = "a9e126c952c91e19e064a962dda7d815a43564e5";

const VERSIONS: Readonly<Record<ToolId, string>> = {
  bun: "1.4.2",
  node: "v26.7.0",
  git: "git version 2.55.0",
  python3: "Python 3.14.7",
  java: 'openjdk version "21.0.12" 2026-07-15',
  shasum: "6.04",
  curl: "curl 8.22.0",
  uv: "uv 0.13.5",
  zstd: "*** Zstandard CLI (64-bit) v1.5.7, by Yann Collet ***",
  ollama: "ollama version is 0.33.3",
};

const tools = (missing: readonly ToolId[] = []): Record<ToolId, ToolProbe> =>
  Object.fromEntries(
    TOOL_IDS.map((id) => [id, { output: missing.includes(id) ? null : VERSIONS[id] }]),
  ) as Record<ToolId, ToolProbe>;

const cohortRows = (
  cohortId: string,
  n: number,
  extra: Partial<CohortRows> = {},
): CohortRows => ({ cohortId, synthetic: n, total: n, hasObservations: true, ...extra });

const PINNED_BUNDLES: BundleSet = { count: 37, sha256: EVAL_COHORT.bundleSetSha256 };

const okDatabase = (
  warehouse: readonly CohortRows[],
  evalBundles: BundleSet | null = null,
): DatabaseProbe => ({
  kind: "ok",
  pgvector: true,
  serverMajor: 18,
  appliedMigrations: ["20261025000000_baseline"],
  warehouse,
  evalBundles,
  exampleThread: false,
});

/** The warehouse Peter's Mac had: the evaluation cohort from before the dates were fixed. */
const OLD_EVAL = okDatabase([cohortRows("synthea-v4-seed42", 35)], {
  count: 35,
  sha256: "0".repeat(64),
});

/** A machine where everything is installed and done. */
const ready: DetectedState = {
  platform: "darwin",
  tools: tools(),
  envFile: true,
  dataMode: "synthetic",
  authOff: true,
  localUserId: "local",
  database: okDatabase([cohortRows("synthea-v4-seed42", 37)], PINNED_BUNDLES),
  migrations: ["20261025000000_baseline"],
  openTwin: { pinned: PIN, synced: PIN },
  anatomyMissing: [],
  riggedMissing: [],
  ollama: {
    kind: "ok",
    baseUrl: "http://127.0.0.1:11434",
    models: ["qwen3:8b", "nomic-embed-text:latest"],
  },
  freeDiskBytes: 500e9,
};

/** A fresh clone on a Mac with Homebrew Postgres and nothing else done. */
const fresh: DetectedState = {
  ...ready,
  envFile: false,
  database: {
    kind: "missing-database",
    name: "twin_llm_synthetic",
    pgvector: true,
    serverMajor: 18,
  },
  openTwin: { pinned: PIN, synced: null },
  anatomyMissing: ["bodyparts3d.ao.glb"],
  riggedMissing: ["anny-adult-m.rigged.glb", "anny-adult-f.rigged.glb"],
};

/** The cohort step's index from the end: the example thread comes after it. */
const COHORT = -2;

const summary = (steps: readonly Step[]): readonly string[] =>
  steps.map((step) =>
    step.status === "run"
      ? `${step.id}: run ${step.action.kind}`
      : `${step.id}: ${step.status} ${step.reason}`,
  );

describe("planSetup", () => {
  test("a machine that is already set up only reinstalls and migrates (both idempotent)", () => {
    expect(summary(planSetup(ready, { cohort: "eval" }))).toEqual([
      "env-file: skip present (left as it is)",
      "open-twin: skip already at a9e126c",
      "install: run command",
      "database: skip reachable, pgvector available",
      "migrate: run command",
      "anatomy: skip all installed",
      "rigged: skip both installed",
      "cohort: skip warehouse already has synthea-v4-seed42 (37 subjects)",
      "example: run insert-example",
    ]);
  });

  test("a fresh clone runs every step and generates the eval cohort", () => {
    expect(summary(planSetup(fresh, { cohort: "eval" }))).toEqual([
      "env-file: run create-env-file",
      "open-twin: run command",
      "install: run command",
      "database: run create-database",
      "migrate: run command",
      "anatomy: run command",
      "rigged: run install-rigged",
      "cohort: run load-eval",
      "example: run insert-example",
    ]);
  });

  test("the atlases are fetched without the rigged bodies, which have their own step", () => {
    const anatomy = planSetup(fresh, { cohort: "eval" }).find(
      (step) => step.id === "anatomy",
    );
    expect(anatomy?.status === "run" ? anatomy.action : null).toEqual({
      kind: "command",
      argv: ["bun", "run", "anatomy:fetch", "--skip-rigged"],
    });
  });

  test("rigged bodies are downloaded from the release, with the bake as fallback when uv is there", () => {
    const rigged = planSetup(fresh, { cohort: "eval" }).find(
      (step) => step.id === "rigged",
    );
    expect(rigged).toEqual({
      id: "rigged",
      title: "Rigged demo bodies for Walk/Idle/Dance (anatomy:fetch, bake as fallback)",
      after: [],
      status: "run",
      action: {
        kind: "install-rigged",
        ids: ["anny-adult-m", "anny-adult-f"],
        noBake: null,
      },
      note: "download from release anatomy-rigged-v1; bake locally only if that fails",
    });
  });

  test("without uv the rigged bodies are still downloaded, only the fallback is gone", () => {
    const rigged = planSetup(
      { ...fresh, tools: tools(["uv"]), riggedMissing: ["anny-adult-f.rigged.glb"] },
      { cohort: "eval" },
    ).find((step) => step.id === "rigged");
    expect(rigged).toEqual({
      id: "rigged",
      title: "Rigged demo bodies for Walk/Idle/Dance (anatomy:fetch, bake as fallback)",
      after: [],
      status: "run",
      action: {
        kind: "install-rigged",
        ids: ["anny-adult-f"],
        noBake:
          "the download failed and the bake fallback needs uv (uv not found: brew install uv). Then run bun run setup:local again. The demo bodies stay static until then.",
      },
      note: "download from release anatomy-rigged-v1 (no uv, so no bake fallback)",
    });
  });

  test("the eval cohort is downloaded from its release, with Synthea as the fallback", () => {
    expect(planSetup(fresh, { cohort: "eval" }).at(COHORT)).toEqual({
      id: "cohort",
      title: "Synthetic cohort in the warehouse",
      after: ["migrate"],
      status: "run",
      action: { kind: "load-eval", source: { kind: "download", noGenerate: null } },
      note: "download eval-cohort-synthea-v4-seed42-20260101.tar.zst from release eval-cohort-v1, verify (Synthea generates it instead if the release cannot be reached), ingest",
    });
  });

  test("without Java the download still runs; only the generate fallback is gone", () => {
    expect(
      planSetup(
        { ...fresh, platform: "linux", tools: tools(["java"]) },
        { cohort: "eval" },
      ).at(COHORT),
    ).toEqual({
      id: "cohort",
      title: "Synthetic cohort in the warehouse",
      after: ["migrate"],
      status: "run",
      action: {
        kind: "load-eval",
        source: {
          kind: "download",
          noGenerate: "Java not found: sudo apt install openjdk-21-jre-headless",
        },
      },
      note: "download eval-cohort-synthea-v4-seed42-20260101.tar.zst from release eval-cohort-v1, verify (no Java, so no local fallback), ingest",
    });
  });

  test("without zstd the cohort is generated, and the note says it matches the pin on x86_64 only", () => {
    expect(
      planSetup(
        { ...fresh, platform: "linux", tools: tools(["zstd"]) },
        { cohort: "eval" },
      ).at(COHORT),
    ).toEqual({
      id: "cohort",
      title: "Synthetic cohort in the warehouse",
      after: ["migrate"],
      status: "run",
      action: { kind: "load-eval", source: { kind: "generate" } },
      note: "no zstd to unpack the release (zstd not found: sudo apt install zstd), so generate synthea-v4-seed42 with Synthea (fixed seed and dates), verify (matches the pin on x86_64 only), ingest",
    });
  });

  test("--generate-cohort generates with Synthea, and without Java it is blocked", () => {
    expect(planSetup(fresh, { cohort: "eval", generateCohort: true }).at(COHORT)).toEqual(
      {
        id: "cohort",
        title: "Synthetic cohort in the warehouse",
        after: ["migrate"],
        status: "run",
        action: { kind: "load-eval", source: { kind: "generate" } },
        note: "--generate-cohort: generate synthea-v4-seed42 with Synthea (fixed seed and dates), verify, ingest",
      },
    );
    expect(
      summary(
        planSetup(
          { ...fresh, platform: "linux", tools: tools(["java"]) },
          { cohort: "eval", generateCohort: true },
        ),
      ).at(COHORT),
    ).toBe(
      "cohort: blocked Java not found: sudo apt install openjdk-21-jre-headless. --generate-cohort needs Java; without the flag setup downloads the pinned files instead. Then run bun run setup:local again to load synthea-v4-seed42.",
    );
  });

  test("without zstd and Java an empty warehouse gets the three fixtures and says how to get the eval cohort", () => {
    const cohort = planSetup(
      { ...fresh, platform: "linux", tools: tools(["java", "zstd"]) },
      { cohort: "eval" },
    ).at(COHORT);
    expect(cohort).toEqual({
      id: "cohort",
      title: "Synthetic cohort in the warehouse",
      after: ["migrate"],
      status: "run",
      action: { kind: "load-fixtures" },
      note: "cannot download or generate the eval cohort here, so only the three trimmed fixtures (open-twin-synthea-trimmed-3). zstd not found: sudo apt install zstd; Java not found: sudo apt install openjdk-21-jre-headless. Then run bun run setup:local again to load synthea-v4-seed42.",
    });
  });

  test("without zstd, Java too old and the fixtures already loaded: blocked, nothing re-ingested", () => {
    const state: DetectedState = {
      ...ready,
      tools: { ...tools(["zstd"]), java: { output: 'openjdk version "17.0.2"' } },
      database: okDatabase([cohortRows("open-twin-synthea-trimmed-3", 3)]),
    };
    const cohort = planSetup(state, { cohort: "eval" }).at(COHORT);
    expect(cohort?.status).toBe("blocked");
    expect(cohort?.status === "blocked" ? cohort.reason : "").toBe(
      "zstd not found: brew install zstd; Java 17.0.2 found, 21 or newer needed: brew install openjdk@21 && echo 'export PATH=\"$(brew --prefix openjdk@21)/bin:$PATH\"' >> ~/.zshrc. Then run bun run setup:local again to load synthea-v4-seed42.",
    );
  });

  test("with the fixtures loaded, the eval cohort deletes them first: they are its people (#96)", () => {
    const withFixtures: DetectedState = {
      ...ready,
      database: okDatabase([cohortRows("open-twin-synthea-trimmed-3", 4)]),
    };
    expect(planSetup(withFixtures, { cohort: "eval" }).at(COHORT)).toEqual({
      id: "cohort",
      title: "Synthetic cohort in the warehouse",
      after: ["migrate"],
      status: "run",
      action: {
        kind: "load-eval",
        source: { kind: "download", noGenerate: null },
        fixtureSubjects: 4,
      },
      note: "download eval-cohort-synthea-v4-seed42-20260101.tar.zst from release eval-cohort-v1, verify (Synthea generates it instead if the release cannot be reached); first delete the 4 subjects of open-twin-synthea-trimmed-3, who are also in synthea-v4-seed42, ingest",
    });
    const reload = planSetup(
      {
        ...ready,
        database: okDatabase(
          [
            cohortRows("open-twin-synthea-trimmed-3", 4),
            cohortRows("synthea-v4-seed42", 34),
          ],
          { count: 34, sha256: "0".repeat(64) },
        ),
      },
      { cohort: "eval", reloadCohort: true },
    ).at(COHORT);
    expect(reload?.status === "run" ? reload.action : null).toEqual({
      kind: "reload-eval",
      cohortId: "synthea-v4-seed42",
      subjects: 34,
      source: { kind: "download", noGenerate: null },
      fixtureSubjects: 4,
    });
    // Without the fixtures the action does not mention them.
    const plain = planSetup(
      { ...ready, database: okDatabase([]) },
      { cohort: "eval" },
    ).at(COHORT);
    expect(plain?.status === "run" ? plain.action : null).toEqual({
      kind: "load-eval",
      source: { kind: "download", noGenerate: null },
    });
  });

  test("--cohort-10k downloads when that cohort is empty, even with the eval cohort loaded", () => {
    expect(summary(planSetup(ready, { cohort: "10k" })).at(COHORT)).toBe(
      "cohort: run load-10k",
    );
  });

  test("--cohort-10k is skipped when loaded and blocked without disk or zstd", () => {
    const loaded: DetectedState = {
      ...ready,
      database: okDatabase([cohortRows("synthea-v4-seed42-10k", 10_000)]),
    };
    expect(summary(planSetup(loaded, { cohort: "10k" })).at(COHORT)).toBe(
      "cohort: skip synthea-v4-seed42-10k already has 10000 subjects",
    );
    expect(
      summary(planSetup({ ...ready, freeDiskBytes: 20e9 }, { cohort: "10k" })).at(COHORT),
    ).toBe(
      "cohort: blocked the 10k cohort needs about 45.0 GB free here, 20.0 GB available",
    );
    expect(
      summary(planSetup({ ...ready, tools: tools(["zstd"]) }, { cohort: "10k" })).at(
        COHORT,
      ),
    ).toBe("cohort: blocked zstd not found: brew install zstd");
  });

  test("--skip-cohort skips the cohort only", () => {
    expect(summary(planSetup(fresh, { cohort: "none" })).at(COHORT)).toBe(
      "cohort: off not loaded (--skip-cohort)",
    );
  });

  test("Postgres down blocks database, migrations and cohort with the install line", () => {
    const steps = summary(
      planSetup(
        { ...fresh, database: { kind: "unreachable", detail: "ECONNREFUSED" } },
        { cohort: "eval" },
      ),
    );
    expect(steps.slice(3, 5)).toEqual([
      "database: blocked Postgres is not reachable at DATABASE_URL (ECONNREFUSED): brew install postgresql@18 && brew services start postgresql@18",
      "migrate: blocked needs the database",
    ]);
    expect(steps.at(COHORT)).toBe("cohort: blocked needs the database");
  });

  test("missing pgvector names the package for the server's major version", () => {
    const steps = planSetup(
      {
        ...fresh,
        platform: "linux",
        database: {
          kind: "missing-database",
          name: "x",
          pgvector: false,
          serverMajor: 17,
        },
      },
      { cohort: "eval" },
    );
    expect(summary(steps)[3]).toBe(
      "database: blocked pgvector is not installed in this Postgres: sudo apt install postgresql-17-pgvector (PGDG apt repository)",
    );
  });

  test("an evaluation cohort that is not the pinned one is reported stale, not skipped", () => {
    expect(
      planSetup({ ...ready, database: OLD_EVAL }, { cohort: "eval" }).at(COHORT),
    ).toEqual({
      id: "cohort",
      title: "Synthetic cohort in the warehouse",
      after: ["migrate"],
      status: "stale",
      reason:
        "synthea-v4-seed42 in the warehouse is an older copy (35 subjects, the pinned cohort has 37; its 35 ingested bundles are not the pinned files). Fix: bun run setup:local -- --reload-cohort (replaces this cohort's warehouse rows and nothing else)",
    });
  });

  test("--reload-cohort replaces a loaded evaluation cohort", () => {
    expect(
      planSetup(
        { ...ready, database: OLD_EVAL },
        { cohort: "eval", reloadCohort: true },
      ).at(COHORT),
    ).toEqual({
      id: "cohort",
      title: "Synthetic cohort in the warehouse",
      after: ["migrate"],
      status: "run",
      action: {
        kind: "reload-eval",
        cohortId: "synthea-v4-seed42",
        subjects: 35,
        source: { kind: "download", noGenerate: null },
      },
      note: "download eval-cohort-synthea-v4-seed42-20260101.tar.zst from release eval-cohort-v1, verify (Synthea generates it instead if the release cannot be reached); then delete its 35 subjects' warehouse rows in one transaction and ingest the pinned cohort",
    });
    // Asked for explicitly, so it reloads a current cohort too.
    expect(
      summary(planSetup(ready, { cohort: "eval", reloadCohort: true })).at(COHORT),
    ).toBe("cohort: run reload-eval");
  });

  test("--reload-cohort --generate-cohort generates before it deletes", () => {
    const step = planSetup(
      { ...ready, database: OLD_EVAL },
      { cohort: "eval", reloadCohort: true, generateCohort: true },
    ).at(COHORT);
    expect(step?.status === "run" ? step.action : null).toEqual({
      kind: "reload-eval",
      cohortId: "synthea-v4-seed42",
      subjects: 35,
      source: { kind: "generate" },
    });
  });

  test("--reload-cohort with nothing loaded just loads, and with no way to get the cohort deletes nothing", () => {
    expect(
      summary(
        planSetup(
          {
            ...ready,
            database: okDatabase([cohortRows("open-twin-synthea-trimmed-3", 3)]),
          },
          { cohort: "eval", reloadCohort: true },
        ),
      ).at(COHORT),
    ).toBe("cohort: run load-eval");
    expect(
      summary(
        planSetup(
          { ...ready, database: OLD_EVAL, tools: tools(["java", "zstd"]) },
          { cohort: "eval", reloadCohort: true },
        ),
      ).at(COHORT),
    ).toBe(
      "cohort: blocked zstd not found: brew install zstd; Java not found: brew install openjdk@21 && echo 'export PATH=\"$(brew --prefix openjdk@21)/bin:$PATH\"' >> ~/.zshrc. --reload-cohort loads synthea-v4-seed42 first; nothing was deleted.",
    );
  });

  test("open-twin sync waits for git", () => {
    expect(
      summary(
        planSetup(
          { ...fresh, platform: "linux", tools: tools(["git"]) },
          { cohort: "eval" },
        ),
      )[1],
    ).toBe("open-twin: blocked git not found: sudo apt install git");
  });
});

describe("evalCohortState", () => {
  test("pinned subjects and bundles: current", () => {
    expect(evalCohortState(ready.database)).toEqual({ kind: "current", subjects: 37 });
  });

  test("37 subjects but other bundles: stale by the fingerprint alone", () => {
    expect(
      evalCohortState(
        okDatabase([cohortRows("synthea-v4-seed42", 37)], {
          count: 37,
          sha256: "f".repeat(64),
        }),
      ),
    ).toEqual({
      kind: "stale",
      subjects: 37,
      why: "its 37 ingested bundles are not the pinned files",
    });
  });

  test("wrong count with no bundle table: stale by the count", () => {
    expect(evalCohortState(okDatabase([cohortRows("synthea-v4-seed42", 35)]))).toEqual({
      kind: "stale",
      subjects: 35,
      why: "35 subjects, the pinned cohort has 37",
    });
  });

  test("not loaded, or no database: absent", () => {
    expect(evalCohortState(okDatabase([cohortRows("synthea-v4-seed42-10k", 9)]))).toEqual(
      {
        kind: "absent",
      },
    );
    expect(evalCohortState({ kind: "no-url" })).toEqual({ kind: "absent" });
  });
});

describe("blockedBy", () => {
  const migrate = planSetup(ready, { cohort: "eval" }).find(
    (step) => step.id === "migrate",
  );
  if (!migrate) throw new Error("no migrate step");

  test("a skipped (already done) dependency does not block", () => {
    const earlier: Outcome[] = [
      { id: "database", title: "Postgres database", result: "skipped", detail: "" },
      { id: "install", title: "Dependencies (bun install)", result: "done", detail: "" },
    ];
    expect(blockedBy(migrate, earlier)).toBeNull();
  });

  test("a failed dependency blocks and is named", () => {
    const earlier: Outcome[] = [
      { id: "database", title: "Postgres database", result: "done", detail: "" },
      {
        id: "install",
        title: "Dependencies (bun install)",
        result: "failed",
        detail: "",
      },
    ];
    expect(blockedBy(migrate, earlier)).toBe("needs Dependencies (bun install)");
  });
});

describe("formatChecklist", () => {
  test("lists each step and ends with what to do next", () => {
    expect(
      formatChecklist([
        { id: "migrate", title: "Migrations", result: "done", detail: "done" },
        {
          id: "rigged",
          title: "Rigged bodies",
          result: "blocked",
          detail: "uv not found",
        },
        {
          id: "cohort",
          title: "Cohort",
          result: "off",
          detail: "not loaded (--skip-cohort)",
        },
      ]),
    ).toBe(
      [
        "",
        "Setup checklist",
        "[ready]   Migrations: done",
        "[skipped] Rigged bodies: uv not found",
        "[off]     Cohort: not loaded (--skip-cohort)",
        "",
        "1 item(s) need attention (above). Fix them and run bun run setup:local again; finished steps are skipped.",
        "",
      ].join("\n"),
    );
  });
});

describe("formatChecklist with a stale cohort", () => {
  test("marks it [stale] and counts it as needing attention", () => {
    expect(
      formatChecklist([
        { id: "cohort", title: "Cohort", result: "stale", detail: "older copy. Fix: x" },
      ]),
    ).toBe(
      [
        "",
        "Setup checklist",
        "[stale]   Cohort: older copy. Fix: x",
        "",
        "1 item(s) need attention (above). Fix them and run bun run setup:local again; finished steps are skipped.",
        "",
      ].join("\n"),
    );
  });
});

describe("pageReadiness", () => {
  test("a ready machine", () => {
    expect(
      pageReadiness(ready).map(
        (page) => `${page.ready ? "ready" : "missing"} ${page.page}: ${page.detail}`,
      ),
    ).toEqual([
      "ready Data page (/data): synthea-v4-seed42 (37 subjects)",
      "ready Body twin Demo lab values: synthea-v4-seed42",
      "ready Body twin anatomy and demo bodies: all installed",
      "ready Body twin Walk/Idle: rigged demo bodies installed",
      "ready Chat (local model): qwen3:8b",
    ]);
  });

  test("an empty warehouse, no rigged bodies, no uv and Ollama down", () => {
    const state: DetectedState = {
      ...ready,
      tools: tools(["uv"]),
      database: okDatabase([]),
      riggedMissing: ["anny-adult-f.rigged.glb"],
      ollama: { kind: "unreachable", baseUrl: "http://127.0.0.1:11434" },
    };
    expect(pageReadiness(state).map((page) => page.detail)).toEqual([
      "no synthetic cohort loaded: bun run setup:local",
      "needs open-twin-synthea-trimmed-3 or synthea-v4-seed42: bun run setup:local",
      "all installed",
      "rigged bodies missing (anny-adult-f.rigged.glb): bun run anatomy:fetch downloads them from release anatomy-rigged-v1; offline, bun run anatomy:bake-rigged after installing uv (uv not found: brew install uv)",
      "Ollama not answering at http://127.0.0.1:11434: start it (ollama serve), then ollama pull qwen3:8b && ollama pull nomic-embed-text",
    ]);
  });

  test("pending migrations are named before the cohort", () => {
    const pending: DetectedState = {
      ...ready,
      migrations: ["20261025000000_baseline", "20261026142947_model_response_tool_parts"],
    };
    expect(pageReadiness(pending)[0]?.detail).toBe(
      "1 migration(s) not applied: bun run setup:local",
    );
  });

  test("personal mode still shows the synthetic Data page and Demo lab values", () => {
    expect(
      pageReadiness({ ...ready, dataMode: "personal" })
        .slice(0, 2)
        .map((page) => [page.ready, page.detail]),
    ).toEqual([
      [true, "synthea-v4-seed42 (37 subjects)"],
      [true, "synthea-v4-seed42"],
    ]);
  });

  test("a stale evaluation cohort still shows, marked stale with the fix", () => {
    expect(pageReadiness({ ...ready, database: OLD_EVAL })[0]).toEqual({
      page: "Data page (/data)",
      ready: true,
      stale: true,
      detail:
        "synthea-v4-seed42 in the warehouse is an older copy (35 subjects, the pinned cohort has 37; its 35 ingested bundles are not the pinned files). Fix: bun run setup:local -- --reload-cohort (replaces this cohort's warehouse rows and nothing else)",
    });
  });
});

describe("dataPageFindings", () => {
  const lines = (state: DetectedState): readonly string[] =>
    dataPageFindings(state).map((finding) => `${finding.mark} ${finding.text}`);

  test("a ready machine", () => {
    expect(lines(ready)).toEqual([
      "ok DATA_MODE=synthetic",
      "ok synthea-v4-seed42: 37 synthetic subject(s), in SYNTHETIC_COHORTS, observation rows present",
    ]);
  });

  test("names each reason a cohort would not show", () => {
    const state: DetectedState = {
      ...ready,
      dataMode: "personal",
      database: okDatabase([
        cohortRows("my-own-cohort", 12),
        cohortRows("open-twin-synthea-trimmed-3", 0, { total: 3 }),
        cohortRows("synthea-v4-seed42", 35, { hasObservations: false }),
        cohortRows("synthea-v4-seed4242", 50),
      ]),
    };
    expect(lines(state)).toEqual([
      "no DATA_MODE=personal: the page reads the warehouse only with DATA_MODE=synthetic (.env.local)",
      "no my-own-cohort: 12 subject(s), not in SYNTHETIC_COHORTS (packages/query-tools/scope.ts), so the page never lists it",
      "no open-twin-synthea-trimmed-3: 0 synthetic subject(s) of 3; only is_synthetic subjects are shown",
      "no synthea-v4-seed42: 35 synthetic subject(s), in SYNTHETIC_COHORTS, but no observation rows: ingest it again with bun run setup:local",
      "ok synthea-v4-seed4242: 50 synthetic subject(s), in SYNTHETIC_COHORTS, observation rows present",
    ]);
  });

  test("a stale evaluation cohort, an empty warehouse, no database", () => {
    expect(lines({ ...ready, database: OLD_EVAL })[1]).toBe(
      "stale synthea-v4-seed42: 35 synthetic subject(s): synthea-v4-seed42 in the warehouse is an older copy (35 subjects, the pinned cohort has 37; its 35 ingested bundles are not the pinned files). Fix: bun run setup:local -- --reload-cohort (replaces this cohort's warehouse rows and nothing else)",
    );
    expect(lines({ ...ready, database: okDatabase([]) })).toEqual([
      "ok DATA_MODE=synthetic",
      "no the warehouse has no subjects: bun run setup:local loads synthea-v4-seed42",
    ]);
    expect(lines({ ...ready, database: { kind: "no-url" } })).toEqual([
      "ok DATA_MODE=synthetic",
      "no DATABASE_URL is not set in .env.local",
    ]);
  });
});

describe("the example thread step", () => {
  const exampleOf = (state: DetectedState, options: SetupOptions = { cohort: "eval" }) =>
    summary(planSetup(state, options)).at(-1);
  const withThread: DetectedState = {
    ...ready,
    database: {
      ...okDatabase([cohortRows("synthea-v4-seed42", 37)]),
      exampleThread: true,
    },
  };

  test("runs for the local user, after the migrations", () => {
    const step = planSetup(fresh, { cohort: "eval" }).at(-1);
    expect(step?.after).toEqual(["migrate"]);
    expect(step?.status === "run" ? step.action : null).toEqual({
      kind: "insert-example",
      clerkId: "local",
    });
  });

  test("is skipped when the thread exists, off on request, with auth on or personal data", () => {
    expect(exampleOf(withThread)).toBe(
      "example: skip already in Your threads for LOCAL_USER_ID=local",
    );
    expect(exampleOf(ready, { cohort: "eval", skipExample: true })).toBe(
      "example: off not added (--skip-example)",
    );
    expect(exampleOf({ ...ready, authOff: false })).toBe(
      "example: off auth is on (no LOCAL_MVP or AUTH_DISABLED), so there is no local user",
    );
    expect(exampleOf({ ...ready, dataMode: "personal" })).toBe(
      "example: off only with DATA_MODE=synthetic (now personal)",
    );
    expect(
      exampleOf({ ...fresh, database: { kind: "unreachable", detail: "ECONNREFUSED" } }),
    ).toBe("example: blocked needs the database");
  });

  test("doctor reports it without counting it as something to fix", () => {
    expect(exampleSummary(withThread)).toEqual({
      ok: true,
      detail: '"Example (synthetic)" in Your threads for LOCAL_USER_ID=local',
    });
    expect(exampleSummary(ready)).toEqual({
      ok: false,
      detail:
        '"Example (synthetic)" not in Your threads: bun run setup:local adds it (--skip-example leaves it out)',
    });
    expect(exampleSummary({ ...ready, dataMode: "personal" })).toEqual({
      ok: false,
      detail:
        '"Example (synthetic)" not added: only with DATA_MODE=synthetic (now personal)',
    });
  });
});
