import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEV_OPTIONS, generateW1 } from "../../synthetic-wearables/w1-items";

import { modelFor, parseStudyArgs, runStudyCli } from "./study";

const dir = await mkdtemp(join(tmpdir(), "attribution-study-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

const itemsPath = join(dir, "items.json");
await writeFile(
  itemsPath,
  JSON.stringify({ testData: true, items: generateW1(DEV_OPTIONS).slice(0, 6) }),
);

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    },
    out,
    err,
  };
};

describe("modelFor", () => {
  test("fakes by policy and local Ollama tags", () => {
    expect(modelFor("fake:first_listed")).toMatchObject({ id: "fake:first_listed" });
    expect(modelFor("ollama:qwen3:4b")).toMatchObject({ id: "ollama:qwen3:4b" });
    expect(modelFor("fake:nope")).toBeString();
    expect(modelFor("openai:gpt")).toBeString();
    expect(modelFor("ollama:qwen3:4b", 0)).toMatchObject({
      id: "ollama:qwen3:4b@temperature=0",
    });
    expect(
      parseStudyArgs([
        "--items",
        "x",
        "--model",
        "ollama:qwen3:4b",
        "--temperature",
        "hot",
      ]),
    ).toBe("--temperature must be a number from 0 to 2.");
  });
});

describe("parseStudyArgs", () => {
  test("defaults: every condition, one repeat, no reruns, beside the items", () => {
    const args = parseStudyArgs(["--items", itemsPath, "--model", "fake:first_listed"]);
    expect(args).toMatchObject({
      kind: "run",
      conditions: ["C0", "C1", "C2"],
      repeats: 1,
      counterfactual: false,
      out: join(dir, "run-fake-first-listed"),
    });
  });

  test("bad flags say what is wrong", () => {
    expect(parseStudyArgs([])).toBe("--items <items.json> is required.");
    expect(
      parseStudyArgs([
        "--items",
        "x",
        "--model",
        "fake:first_listed",
        "--conditions",
        "C9",
      ]),
    ).toBe("--conditions takes C0, C1, C2.");
    expect(
      parseStudyArgs(["--items", "x", "--model", "fake:first_listed", "--repeats", "0"]),
    ).toBe("--repeats must be a whole number from 1 to 10.");
  });
});

describe("runStudyCli", () => {
  test("writes one record per answer and the report, and the report can be rebuilt", async () => {
    const out = join(dir, "run");
    const first = io();
    const code = await runStudyCli(
      [
        "--items",
        itemsPath,
        "--model",
        "fake:first_listed",
        "--conditions",
        "C1",
        "--counterfactual",
        "--out",
        out,
      ],
      first.io,
    );
    expect(code).toBe(0);
    const lines = (await readFile(join(out, "records.jsonl"), "utf8")).trim().split("\n");
    expect(lines.length).toBeGreaterThan(6);
    const report = await readFile(join(out, "report.md"), "utf8");
    expect(report).toContain("## fake:first_listed");

    const second = io();
    expect(await runStudyCli(["--report", join(out, "records.jsonl")], second.io)).toBe(
      0,
    );
    expect(await readFile(join(out, "report.md"), "utf8")).toBe(report);
  });

  test("refuses a file that is not a W1 items file", async () => {
    const other = join(dir, "other.json");
    await writeFile(other, JSON.stringify({ items: [] }));
    const result = io();
    expect(
      await runStudyCli(["--items", other, "--model", "fake:first_listed"], result.io),
    ).toBe(1);
    expect(result.err.join("")).toContain("W1 items file");
  });
});
