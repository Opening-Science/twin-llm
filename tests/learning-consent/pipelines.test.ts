import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LEARNING_SCOPES, type LearningScope } from "@/infrastructure/learning-consent";

/**
 * Every command that could learn from data asks the learning-consent gate
 * (#145, docs/privacy-design.md 2.4), as `tests/personal-reads` does for
 * routes. Each package script is listed here, either as a pipeline with the
 * file that calls `requireLearningConsent` and its scope, or with the reason
 * it reads no row a model could learn from. A new script, or a new entry file
 * under the training, evaluation, heart-brain or disclosure folders, fails until
 * it is listed. The per-pipeline refusals are tested next to each pipeline.
 */

type Gated = Readonly<{
  /** The file the package script runs. */
  entry: string;
  /** The file that calls the gate (the entry, or the runner it wires). */
  gate: string;
  scope: LearningScope;
}>;

const CONVERSATIONS: Gated = {
  entry: "scripts/training-data/build-conversations.ts",
  gate: "scripts/training-data/build-conversations.ts",
  scope: "training",
};
const ANSWER_KEY: Gated = {
  entry: "scripts/evaluation/build-answer-key.ts",
  gate: "scripts/evaluation/build-answer-key.ts",
  scope: "answer-key",
};

const GATED: Readonly<Record<string, Gated>> = {
  "training:conversations": CONVERSATIONS,
  "training:sample": CONVERSATIONS,
  "training:batches": {
    entry: "scripts/training-data/run-batches.ts",
    gate: "scripts/training-data/run-batches.ts",
    scope: "training",
  },
  "training:split": {
    entry: "scripts/training-data/split-conversations.ts",
    gate: "scripts/training-data/split-conversations.ts",
    scope: "training",
  },
  "eval:answer-key": ANSWER_KEY,
  "eval:answer-key:s7": ANSWER_KEY,
  "eval:answer-key:s7b": ANSWER_KEY,
  "eval:answer-key:s7h": ANSWER_KEY,
  "eval:answer-key:hb": ANSWER_KEY,
  "disclosure:prepare": {
    entry: "scripts/disclosure/prepare.ts",
    gate: "scripts/disclosure/prepare.ts",
    scope: "training",
  },
  "eval:answer-key:live": {
    entry: "evaluation/answer-key.test.ts",
    gate: "evaluation/answer-key.test.ts",
    scope: "answer-key",
  },
  eval: {
    entry: "scripts/evaluation/run-eval.ts",
    gate: "scripts/evaluation/eval-runner.ts",
    scope: "evaluation",
  },
  "eval:report": {
    entry: "scripts/evaluation/run-report.ts",
    gate: "scripts/evaluation/run-report.ts",
    scope: "evaluation",
  },
  "eval:agreement": {
    entry: "scripts/evaluation/agreement-run.ts",
    gate: "scripts/evaluation/agreement-run.ts",
    scope: "evaluation",
  },
  "eval:spread-subjects": {
    entry: "scripts/evaluation/spread-subjects.ts",
    gate: "scripts/evaluation/spread-subjects.ts",
    scope: "evaluation",
  },
  "eval:cohort-codes": {
    entry: "scripts/evaluation/build-cohort-codes.ts",
    gate: "scripts/evaluation/build-cohort-codes.ts",
    scope: "evaluation",
  },
  "eval:heldout:s7h": {
    entry: "scripts/evaluation/heldout-s7h.ts",
    gate: "scripts/evaluation/heldout-s7h.ts",
    scope: "evaluation",
  },
};

const APP = "the app or its dev server; personal reads are gated by tests/personal-reads";
const TOOLING = "repository tooling; reads code, docs or config, no data rows";
const SETUP = "setup or self-checks of this machine; counts and modes only";
const PUBLIC = "public reference documents (guidelines, literature, knowledge notes)";
const GENERATOR = "makes synthetic data from a seed; reads no person's rows";
const DB = "schema tooling; moves no rows into any learning set";
const LINK = "links a device or service; no learning";

const NOT_LEARNING: Readonly<Record<string, string>> = {
  "setup:local": SETUP,
  doctor: SETUP,
  "prompt:size": "measures the system prompt and tool list; no data rows",
  dev: APP,
  "dev:http": APP,
  "dev:https": APP,
  "dev:behind-https": APP,
  "https:gateway": APP,
  build: TOOLING,
  start: APP,
  typecheck: TOOLING,
  lint: TOOLING,
  "lint:claims": TOOLING,
  "mcp:serve":
    "serves the query tools to an MCP client; they read the synthetic warehouse, refuse the imported and genome tools, and train nothing",
  format: TOOLING,
  "format:check": TOOLING,
  test: TOOLING,
  "test:isolation": TOOLING,
  postinstall: TOOLING,
  prepare: TOOLING,
  "db:generate": DB,
  "db:migrate": DB,
  "db:deploy": DB,
  "db:push": DB,
  "db:pull": DB,
  "db:verify": DB,
  "db:studio": "the person's own view of their database; no learning",
  "verify:import": TOOLING,
  sbom: TOOLING,
  "lab:local-only": SETUP,
  "lab:storage": SETUP,
  "vault:migrate": "seals the person's own rows in place (#141); no learning",
  "vault:rotate": "reseals the person's own rows under a new key (#141); no learning",
  "skills:check": "runs skill evals over shipped synthetic fixtures; no person's rows",
  "new:tool": TOOLING,
  "new:tool:prove": TOOLING,
  "tools:snapshots": TOOLING,
  "sync:open-twin": TOOLING,
  "sync:verify": TOOLING,
  "flatten:open-twin": TOOLING,
  "oura:proxy": LINK,
  "whoop:proxy": LINK,
  "google-health:setup": LINK,
  "vitronic:connect": LINK,
  "vitronic:mint": LINK,
  "vitronic:cycle": "drives a test scan cycle against the scanner; no learning",
  "anatomy:fetch": PUBLIC,
  "anatomy:bake-rigged": "bakes shipped anatomy meshes; no data rows",
  "fonts:install": TOOLING,
  "synthea:generate": GENERATOR,
  "synthea:s7": GENERATOR,
  "synthea:pin": GENERATOR,
  "rhythm-bench":
    "benchmarks the rhythm detector on simulated signals and the public PhysioNet AFDB, never the app's rows",
  "wearables:generate": GENERATOR,
  "genome:synth": GENERATOR,
  "genome:ingest": "loads synthetic genotypes (genome-synth) into a training database",
  "genome:ingest:db": "loads synthetic genotypes (genome-synth) into a training database",
  "heart-brain":
    "a research analysis of the Synthea 1M archives read by batch number; it has no path to the app database",
  "heart-brain:timing": "reads the people files heart-brain wrote from Synthea archives",
  "heart-brain:wearables":
    "reads the people files heart-brain wrote and synthetic wearable series",
  "heart-brain:af-subset":
    "reads the Synthea 1M archives by batch number; synthetic only, no path to the app database",
  "heart-brain:event-rates":
    "reads the Synthea 1M archives by batch number; synthetic only, no path to the app database",
  "heart-brain:excess":
    "reads the people files heart-brain wrote from Synthea archives; synthetic only",
  "heart-brain:oracle":
    "reads the Synthea 1M archives by batch number; synthetic only, no path to the app database",
  "disclosure:analyze":
    "scores the files the GPU steps wrote from the sets disclosure:prepare made under the gate; reads no subject row",
  "eval:hb-verdicts":
    "tallies verdict phrases in eval runs, each gated when it ran; reads no subject row",
  "warehouse:ingest":
    "loads synthetic cohorts into the warehouse; it refuses other labels",
  "knowledge:ingest": PUBLIC,
  "eval:guidelines": PUBLIC,
  "eval:router-fixture": "labels the committed question text; reads no subject",
  "literature:fetch": PUBLIC,
  "literature:ingest": PUBLIC,
  "knowledge:biomarkers": PUBLIC,
  "ark:build": "builds the Ark app; no data rows",
  "ark:test": "tests the Ark app on synthetic fixtures",
};

/** Entry files in the learning folders that are not a package script's pipeline. */
const OTHER_ENTRIES: Readonly<Record<string, string>> = {
  "scripts/evaluation/build-router-fixture.ts": NOT_LEARNING["eval:router-fixture"] ?? "",
  "scripts/heart-brain/run.ts": NOT_LEARNING["heart-brain"] ?? "",
  "scripts/heart-brain/oracle-run.ts": NOT_LEARNING["heart-brain:oracle"] ?? "",
  "scripts/heart-brain/af-subset-run.ts": NOT_LEARNING["heart-brain:af-subset"] ?? "",
  "scripts/heart-brain/event-rates-reference-run.ts":
    NOT_LEARNING["heart-brain:event-rates"] ?? "",
  "scripts/heart-brain/excess-run.ts": NOT_LEARNING["heart-brain:excess"] ?? "",
  "scripts/disclosure/analyze.ts": NOT_LEARNING["disclosure:analyze"] ?? "",
  "scripts/evaluation/hb-verdicts-run.ts": NOT_LEARNING["eval:hb-verdicts"] ?? "",
  "scripts/heart-brain/timing-run.ts": NOT_LEARNING["heart-brain:timing"] ?? "",
  "scripts/heart-brain/wearable-recovery-run.ts":
    NOT_LEARNING["heart-brain:wearables"] ?? "",
};

const ROOT = join(import.meta.dir, "../..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const scripts = (
  JSON.parse(read("package.json")) as { scripts: Readonly<Record<string, string>> }
).scripts;

describe("every pipeline asks the learning-consent gate (#145)", () => {
  test("every package script is listed once, as gated or with a reason", () => {
    const gated = Object.keys(GATED);
    const open = Object.keys(NOT_LEARNING);
    expect(gated.filter((name) => open.includes(name))).toEqual([]);
    expect([...gated, ...open].sort()).toEqual(Object.keys(scripts).sort());
    expect(Object.values(NOT_LEARNING).filter((reason) => reason.length === 0)).toEqual(
      [],
    );
  });

  test("each gated script runs the file listed for it", () => {
    for (const [name, rule] of Object.entries(GATED)) {
      expect([name, (scripts[name] ?? "").includes(rule.entry)]).toEqual([name, true]);
    }
  });

  test("each gate file calls the gate with its scope", () => {
    for (const rule of Object.values(GATED)) {
      const source = read(rule.gate);
      const call = new RegExp(`requireLearningConsent\\(\\s*"${rule.scope}"`);
      expect([
        rule.gate,
        LEARNING_SCOPES.includes(rule.scope),
        call.test(source),
      ]).toEqual([rule.gate, true, true]);
    }
  });

  test("an entry that wires a runner passes it the real consent store", () => {
    for (const rule of Object.values(GATED)) {
      if (rule.entry === rule.gate) continue;
      expect([rule.entry, read(rule.entry).includes("databaseLearningGate()")]).toEqual([
        rule.entry,
        true,
      ]);
    }
  });

  test("every entry file in the learning folders is a gated pipeline or listed", () => {
    const isEntry = /\(import\.meta as \{ main\?: boolean \}\)\.main/;
    const commands = Object.values(scripts).join(" ");
    const found = [
      "scripts/training-data",
      "scripts/evaluation",
      "scripts/heart-brain",
      "scripts/disclosure",
    ]
      .flatMap((dir) =>
        readdirSync(join(ROOT, dir))
          .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
          .map((name) => `${dir}/${name}`),
      )
      .filter((file) => isEntry.test(read(file)) || commands.includes(file))
      .sort();
    const known = [
      ...new Set([
        ...Object.values(GATED).map((rule) => rule.entry),
        ...Object.keys(OTHER_ENTRIES),
      ]),
    ].filter((file) => file.startsWith("scripts/"));
    expect(found).toEqual(known.sort());
  });
});
