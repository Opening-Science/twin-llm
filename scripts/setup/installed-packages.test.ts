import { describe, expect, test } from "bun:test";

import { describeProblems, stalePackages } from "./installed-packages";

const satisfies = (version: string, range: string): boolean =>
  Bun.semver.satisfies(version, range);

describe("stalePackages", () => {
  test("a package in package.json but not in node_modules is stale", () => {
    const installed: Record<string, string> = { ai: "7.0.1" };
    expect(
      stalePackages(
        { dependencies: { ai: "^7.0.0", "ollama-ai-provider-v2": "^4.1.0" } },
        (name) => installed[name] ?? null,
        satisfies,
      ),
    ).toEqual([{ name: "ollama-ai-provider-v2", wanted: "^4.1.0", installed: null }]);
  });

  test("an installed version outside the range is stale", () => {
    expect(
      stalePackages({ devDependencies: { prisma: "^7.2.0" } }, () => "7.1.0", satisfies),
    ).toEqual([{ name: "prisma", wanted: "^7.2.0", installed: "7.1.0" }]);
  });

  test("everything installed in range is not stale, and non-semver specs are skipped", () => {
    expect(
      stalePackages(
        { dependencies: { ai: "^7.0.0", local: "file:./vendor/local", git: "github:a/b" } },
        (name) => (name === "ai" ? "7.3.0" : null),
        satisfies,
      ),
    ).toEqual([]);
  });

  test("the message names at most five packages", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      name: `p${i}`,
      wanted: "^1.0.0",
      installed: null,
    }));
    expect(describeProblems(many)).toBe(
      "p0 (not installed), p1 (not installed), p2 (not installed), p3 (not installed), p4 (not installed) and 2 more",
    );
  });
});
