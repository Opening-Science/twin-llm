import { describe, expect, test } from "bun:test";

import { skillFrontmatterSchema } from "./skill-schema";

describe("a skill calling imported-data tools", () => {
  const front = (providers: readonly string[]) => ({
    name: "demo",
    description: "A demo skill",
    tools: ["imported_datasets", "imported_trend"],
    sources: ["imported-data"],
    providers,
  });

  test("may list only a local chat provider", () => {
    const result = skillFrontmatterSchema.safeParse(front(["ollama", "exoscale"]));
    expect(
      result.success ? [] : result.error.issues.map((issue) => issue.message),
    ).toEqual([
      'provider "exoscale" may never read imported data (infrastructure/data-mode-policy.ts), so a skill calling imported-data tools cannot list it',
    ]);
  });

  test("with ollama alone it is valid", () => {
    expect(skillFrontmatterSchema.safeParse(front(["ollama"])).success).toBe(true);
  });

  test("needs the imported-data source", () => {
    const result = skillFrontmatterSchema.safeParse({
      ...front(["ollama"]),
      sources: ["guidelines"],
    });
    expect(
      result.success ? [] : result.error.issues.map((issue) => issue.message),
    ).toEqual([
      'tool "imported_datasets" needs source "imported-data" in sources',
      'tool "imported_trend" needs source "imported-data" in sources',
    ]);
  });
});
