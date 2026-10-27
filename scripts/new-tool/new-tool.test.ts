import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { scaffoldTool } from "./scaffold-tool";
import { newFilePaths, PATHS, ScaffoldError } from "./tool-edits";
import { nameProblem, toolNames } from "./tool-names";

/**
 * The scaffold runs against a temporary copy of the files it reads and
 * edits. A full `tsc` over a scaffolded checkout takes minutes, so it is not
 * run here: `bun run new:tool:prove` does that locally. Here tsc checks
 * stats.ts alone (no imports beyond todo.ts), which proves the marker fails
 * the typecheck with its note in the message.
 */

const REPO = join(import.meta.dir, "..", "..");
const TOOL = "resting_hr_drift";
const TODO_FILE = "packages/query-tools/todo.ts";

const roots: string[] = [];

const tempCopy = (): string => {
  const root = mkdtempSync(join(tmpdir(), "new-tool-"));
  roots.push(root);
  [...Object.values(PATHS), TODO_FILE].forEach((path) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(REPO, path), join(root, path));
  });
  return root;
};

const readAll = (root: string): Record<string, string> =>
  Object.fromEntries(
    Object.values(PATHS).map((path) => [path, readFileSync(join(root, path), "utf8")]),
  );

const todoCalls = (text: string): number => (text.match(/\btodo\(/g) ?? []).length;

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe("tool names", () => {
  test("snake_case is accepted and spelled out for each place", () => {
    expect(nameProblem("resting_hr_drift")).toBeNull();
    expect(toolNames("resting_hr_drift")).toEqual({
      snake: "resting_hr_drift",
      kebab: "resting-hr-drift",
      input: "restingHrDriftInput",
      inputType: "RestingHrDriftInput",
      run: "runRestingHrDrift",
      compute: "computeRestingHrDrift",
      result: "RestingHrDriftResult",
    });
  });

  test.each([
    "RestingHr",
    "resting-hr",
    "_resting",
    "resting__hr",
    "resting_",
    "2fast",
    "",
  ])("%p is refused", (name) => {
    expect(nameProblem(name)).not.toBeNull();
  });

  test("a name over 64 characters is refused", () => {
    expect(nameProblem(`a${"_b".repeat(32)}`)).toBe(
      `"a${"_b".repeat(32)}" is longer than 64 characters`,
    );
  });
});

describe("scaffoldTool", () => {
  test("adds the tool to every place the contract names, each with todo markers", () => {
    const root = tempCopy();
    const before = readAll(root);
    const result = scaffoldTool(root, TOOL);
    const created = newFilePaths(toolNames(TOOL));

    expect(result).toEqual({
      created: [created.test, created.evalDraft],
      edited: Object.values(PATHS).filter(
        (path) => path !== PATHS.viewSchema && path !== PATHS.genomeConstants,
      ),
    });
    const after = readAll(root);
    result.edited.forEach((path) => {
      expect(after[path]).not.toBe(before[path]);
      expect(after[path]).toContain(TOOL);
    });

    const markers = Object.fromEntries(
      [PATHS.schemas, PATHS.stats, PATHS.tools, created.test, created.evalDraft].map(
        (path) => [path, todoCalls(readFileSync(join(root, path), "utf8"))],
      ),
    );
    expect(markers).toEqual({
      [PATHS.schemas]: 3,
      [PATHS.stats]: 1,
      [PATHS.tools]: 1,
      [created.test]: 2,
      [created.evalDraft]: 16,
    });
    expect(after[PATHS.docs]).toContain(
      "| `resting_hr_drift` | `subject_ref`, `loinc`, `start`, `end` | TODO: the output fields | 5000 |",
    );
    expect(after[PATHS.knowledgeSources]).toContain(
      '  "convert_unit",\n  "resting_hr_drift",\n] as const satisfies',
    );
    expect(after[PATHS.knowledgeSourcesTest]).toContain(
      [
        '    expect([...disabledToolNames(["cohort-analytics", "gbd"])].sort()).toEqual([',
        '      "baseline_deviation",',
        '      "compare_windows",',
        '      "convert_unit",',
        '      "coverage",',
        '      "gbd_population",',
        '      "range_position",',
        '      "resting_hr_drift",',
        '      "trend",',
        "    ]);",
      ].join("\n"),
    );
    expect(after[PATHS.trainingToolList]).toContain(
      '      "medications_timeline",\n      "resting_hr_drift",\n      "show_view",',
    );
    expect(after[PATHS.questionSet]).toContain(
      "  resting_hr_drift: restingHrDriftInput,\n",
    );
  });

  test("the eval draft stays outside the scored set", () => {
    const root = tempCopy();
    scaffoldTool(root, TOOL);
    const draft = newFilePaths(toolNames(TOOL)).evalDraft;
    expect(draft).toBe("evaluation/drafts/resting-hr-drift.questions.ts");
    expect(readFileSync(join(root, draft), "utf8")).toContain("Not scored");
    expect(readAll(root)[PATHS.answerKey]).not.toContain("drafts");
  });

  test("running it twice is refused and changes nothing", () => {
    const root = tempCopy();
    scaffoldTool(root, TOOL);
    const once = readAll(root);
    expect(() => scaffoldTool(root, TOOL)).toThrow(
      new ScaffoldError("packages/query-tools/resting-hr-drift.test.ts already exists"),
    );
    expect(readAll(root)).toEqual(once);
  });

  test("an existing tool name is refused", () => {
    const root = tempCopy();
    expect(() => scaffoldTool(root, "trend")).toThrow(
      new ScaffoldError(`tool "trend" already exists (${PATHS.schemas})`),
    );
    expect(() => scaffoldTool(root, "show_view")).toThrow(
      new ScaffoldError(`tool "show_view" already exists (${PATHS.viewSchema})`),
    );
  });

  test("a name whose identifiers already exist is refused", () => {
    const root = tempCopy();
    expect(() => scaffoldTool(root, "observations")).toThrow(
      new ScaffoldError(`${PATHS.tools} already declares ObservationsInput`),
    );
  });

  test("a bad name is refused before anything is read", () => {
    expect(() => scaffoldTool("/nonexistent", "Resting-HR")).toThrow(ScaffoldError);
  });

  test("a missing anchor writes nothing at all", () => {
    const root = tempCopy();
    const docs = join(root, PATHS.docs);
    writeFileSync(docs, readFileSync(docs, "utf8").replace("| `guideline_search`", "|"));
    const before = readAll(root);
    expect(() => scaffoldTool(root, TOOL)).toThrow(
      new ScaffoldError(`${PATHS.docs}: anchor not found: "| \`guideline_search\`"`),
    );
    expect(readAll(root)).toEqual(before);
    const created = newFilePaths(toolNames(TOOL));
    expect(existsSync(join(root, created.test))).toBe(false);
    expect(existsSync(join(root, created.evalDraft))).toBe(false);
  });

  test("tsc fails on the scaffolded stats.ts with the todo note in the message", () => {
    const root = tempCopy();
    scaffoldTool(root, TOOL);
    const tsc = Bun.spawnSync(
      [
        join(REPO, "node_modules", ".bin", "tsc"),
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        join(root, PATHS.stats),
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const errors = tsc.stdout
      .toString()
      .split("\n")
      .filter((line) => line.includes("error TS"));
    expect(tsc.exitCode).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      `error TS2345: Argument of type '"the maths for resting_hr_drift; hand-compute it in resting-hr-drift.test.ts first"' is not assignable to parameter of type '"the maths for resting_hr_drift; hand-compute it in resting-hr-drift.test.ts first" & TodoFillIn'.`,
    );
  });
});
