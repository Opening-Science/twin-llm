import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const HOST_DIRS = [
  join(ROOT, "packages/vitronic"),
  join(ROOT, "features/vitronic"),
  join(ROOT, "app/api/vitronic"),
];

const walk = (abs: string, acc: string[]): void => {
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules") continue;
      walk(join(abs, name), acc);
    }
    return;
  }
  if (abs.endsWith(".test.ts") || abs.endsWith(".test.tsx")) return;
  if (abs.endsWith(".ts") || abs.endsWith(".tsx")) acc.push(abs);
};

describe("vitronic PII guard", () => {
  test("host trees never reference /probands or createBodyLoopClient", () => {
    const files: string[] = [];
    for (const dir of HOST_DIRS) walk(dir, files);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("/probands");
      expect(text).not.toContain("createBodyLoopClient");
      expect(text).not.toContain("grant_type");
      expect(text).not.toContain("ProbandData");
    }
  });
});
