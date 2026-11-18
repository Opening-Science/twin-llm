import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { parseW1Args, renderW1, runW1 } from "./w1";
import { DEV_OPTIONS, generateW1, W1_DEFAULTS } from "./w1-items";

const run = async (argv: readonly string[]) => {
  const written = new Map<string, string>();
  const out: string[] = [];
  const err: string[] = [];
  const code = await runW1(
    argv,
    {
      stdout: { write: (chunk) => out.push(chunk) },
      stderr: { write: (chunk) => err.push(chunk) },
    },
    async (path, text) => {
      written.set(path, text);
    },
  );
  return { code, written, out: out.join(""), err: err.join("") };
};

describe("parseW1Args", () => {
  test("W1 by default, the development set on its own seed", () => {
    expect(parseW1Args([])).toMatchObject({ set: "w1", options: W1_DEFAULTS });
    expect(parseW1Args(["--set", "dev"])).toMatchObject({
      set: "dev",
      options: DEV_OPTIONS,
    });
  });

  test("the development set never takes the confirmatory seed", () => {
    expect(
      parseW1Args(["--set", "dev", "--seed", String(W1_DEFAULTS.seed)]),
    ).toBeString();
  });

  test("bad flags say what is wrong", () => {
    expect(parseW1Args(["--set", "x"])).toBe("--set must be w1 or dev.");
    expect(parseW1Args(["--seed", "-1"])).toBe("--seed must be a whole number.");
    expect(parseW1Args(["--end", "1 Oct"])).toBe("--end must be a date like 2026-10-01.");
  });
});

describe("renderW1", () => {
  test("the manifest records the items file's hash and marks the error model assumed", () => {
    const items = generateW1(DEV_OPTIONS);
    const files = renderW1("dev", DEV_OPTIONS, items);
    const manifest = JSON.parse(files.get("manifest.json") ?? "{}") as {
      testData: boolean;
      itemsSha256: string;
      errorModel: { assumed: boolean };
    };
    expect(manifest.testData).toBe(true);
    expect(manifest.errorModel.assumed).toBe(true);
    expect(manifest.itemsSha256).toBe(
      createHash("sha256")
        .update(files.get("items.json") ?? "")
        .digest("hex"),
    );
  });
});

describe("runW1", () => {
  test("writes two files and prints counts only", async () => {
    const result = await run(["--set", "dev", "--out", "out"]);
    expect(result.code).toBe(0);
    expect([...result.written.keys()].toSorted()).toEqual([
      "out/items.json",
      "out/manifest.json",
    ]);
    expect(result.out).toContain("Items: 66 over 20 people");
    expect(result.out).not.toContain("test-6509-w1-001");
  });

  test("the same flags write the same bytes", async () => {
    const first = await run(["--set", "dev", "--out", "out"]);
    const second = await run(["--set", "dev", "--out", "out"]);
    expect(second.written).toEqual(first.written);
  });

  test("a bad flag writes nothing", async () => {
    const result = await run(["--set", "x"]);
    expect(result.code).toBe(1);
    expect(result.written.size).toBe(0);
  });
});
