import { describe, expect, test } from "bun:test";

import {
  blockedBy,
  type DetectedState,
  formatChecklist,
  type Outcome,
  pageReadiness,
  planSetup,
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

/** A machine where everything is installed and done. */
const ready: DetectedState = {
  platform: "darwin",
  tools: tools(),
  envFile: true,
  dataMode: "synthetic",
  database: {
    kind: "ok",
    pgvector: true,
    serverMajor: 18,
    appliedMigrations: ["20261025000000_baseline"],
    cohorts: { "synthea-v4-seed42": 33 },
  },
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
      "cohort: skip warehouse already has synthea-v4-seed42 (33 subjects)",
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
      "rigged: run command",
      "cohort: run load-eval",
    ]);
  });

  test("without uv the bake is skipped with the install line and the command", () => {
    const rigged = planSetup({ ...fresh, tools: tools(["uv"]) }, { cohort: "eval" }).find(
      (step) => step.id === "rigged",
    );
    expect(rigged).toEqual({
      id: "rigged",
      title: "Rigged demo bodies for Walk/Idle (anatomy:bake-rigged)",
      after: [],
      status: "blocked",
      reason:
        "uv not found: brew install uv. Then run bun run anatomy:bake-rigged (or bun run setup:local again). The demo bodies stay static until then.",
    });
  });

  test("without Java an empty warehouse gets the three fixtures and says how to get the eval cohort", () => {
    const cohort = planSetup(
      { ...fresh, platform: "linux", tools: tools(["java"]) },
      { cohort: "eval" },
    ).at(-1);
    expect(cohort).toEqual({
      id: "cohort",
      title: "Synthetic cohort in the warehouse",
      after: ["migrate"],
      status: "run",
      action: { kind: "load-fixtures" },
      note: "no Java, so only the three trimmed fixtures (open-twin-synthea-trimmed-3). Java not found: sudo apt install openjdk-21-jre-headless. Then run bun run setup:local again to load synthea-v4-seed42.",
    });
  });

  test("Java too old with the fixtures already loaded: blocked, nothing re-ingested", () => {
    const state: DetectedState = {
      ...ready,
      tools: { ...tools(), java: { output: 'openjdk version "17.0.2"' } },
      database: {
        ...ready.database,
        kind: "ok",
        pgvector: true,
        serverMajor: 18,
        appliedMigrations: [],
        cohorts: { "open-twin-synthea-trimmed-3": 3 },
      },
    };
    const cohort = planSetup(state, { cohort: "eval" }).at(-1);
    expect(cohort?.status).toBe("blocked");
    expect(cohort?.status === "blocked" ? cohort.reason : "").toBe(
      "Java 17.0.2 found, 21 or newer needed: brew install openjdk@21 && echo 'export PATH=\"$(brew --prefix openjdk@21)/bin:$PATH\"' >> ~/.zshrc. Then run bun run setup:local again to load synthea-v4-seed42.",
    );
  });

  test("--cohort-10k downloads when that cohort is empty, even with the eval cohort loaded", () => {
    expect(summary(planSetup(ready, { cohort: "10k" })).at(-1)).toBe(
      "cohort: run load-10k",
    );
  });

  test("--cohort-10k is skipped when loaded and blocked without disk or zstd", () => {
    const loaded: DetectedState = {
      ...ready,
      database: {
        kind: "ok",
        pgvector: true,
        serverMajor: 18,
        appliedMigrations: [],
        cohorts: { "synthea-v4-seed42-10k": 10_000 },
      },
    };
    expect(summary(planSetup(loaded, { cohort: "10k" })).at(-1)).toBe(
      "cohort: skip synthea-v4-seed42-10k already has 10000 subjects",
    );
    expect(
      summary(planSetup({ ...ready, freeDiskBytes: 20e9 }, { cohort: "10k" })).at(-1),
    ).toBe(
      "cohort: blocked the 10k cohort needs about 45.0 GB free here, 20.0 GB available",
    );
    expect(
      summary(planSetup({ ...ready, tools: tools(["zstd"]) }, { cohort: "10k" })).at(-1),
    ).toBe("cohort: blocked zstd not found: brew install zstd");
  });

  test("--skip-cohort skips the cohort only", () => {
    expect(summary(planSetup(fresh, { cohort: "none" })).at(-1)).toBe(
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
    expect(steps.at(-1)).toBe("cohort: blocked needs the database");
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

describe("pageReadiness", () => {
  test("a ready machine", () => {
    expect(
      pageReadiness(ready).map(
        (page) => `${page.ready ? "ready" : "missing"} ${page.page}: ${page.detail}`,
      ),
    ).toEqual([
      "ready Data page (/data): synthea-v4-seed42 (33 subjects)",
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
      database: {
        kind: "ok",
        pgvector: true,
        serverMajor: 18,
        appliedMigrations: ["20261025000000_baseline"],
        cohorts: {},
      },
      riggedMissing: ["anny-adult-f.rigged.glb"],
      ollama: { kind: "unreachable", baseUrl: "http://127.0.0.1:11434" },
    };
    expect(pageReadiness(state).map((page) => page.detail)).toEqual([
      "no synthetic cohort loaded: bun run setup:local",
      "needs open-twin-synthea-trimmed-3 or synthea-v4-seed42 with DATA_MODE=synthetic: bun run setup:local",
      "all installed",
      "rigged bodies missing (anny-adult-f.rigged.glb): bun run anatomy:bake-rigged after installing uv (uv not found: brew install uv)",
      "Ollama not answering at http://127.0.0.1:11434: start it (ollama serve), then ollama pull qwen3:8b && ollama pull nomic-embed-text",
    ]);
  });

  test("pending migrations and personal mode are named before the cohort", () => {
    const pending: DetectedState = {
      ...ready,
      migrations: ["20261025000000_baseline", "20261026142947_model_response_tool_parts"],
    };
    expect(pageReadiness(pending)[0]?.detail).toBe(
      "1 migration(s) not applied: bun run setup:local",
    );
    expect(pageReadiness({ ...ready, dataMode: "personal" })[0]?.detail).toBe(
      "DATA_MODE is personal; the page reads only with DATA_MODE=synthetic",
    );
  });
});
