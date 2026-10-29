import { describe, expect, test } from "bun:test";

import { insideRepo } from "./repo-path";

describe("insideRepo", () => {
  test("keeps paths inside the repository", () => {
    expect(insideRepo("/repo", ".research/rhythm-bench/latest.json")).toBe(
      "/repo/.research/rhythm-bench/latest.json",
    );
    expect(insideRepo("/repo", "/repo/evaluation/runs")).toBe("/repo/evaluation/runs");
  });

  test("refuses the root itself and anything outside it", () => {
    expect(insideRepo("/repo", ".")).toBeNull();
    expect(insideRepo("/repo", "../other/latest.json")).toBeNull();
    expect(insideRepo("/repo", "/etc/passwd")).toBeNull();
    expect(insideRepo("/repo", "a/../../x")).toBeNull();
  });
});
