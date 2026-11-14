import { describe, expect, test } from "bun:test";

import { openTwinBase, parseOpenTwinBase } from "./open-twin-base";

const A = "4b42ef944db0b461ca414b8066a5f7aa2594a9ce";
const B = "e6156d9000000000000000000000000000000000";

const upstream = (bases: readonly string[]): string =>
  JSON.stringify({
    repo: "https://github.com/Opening-Science/open-twin",
    packages: Object.fromEntries(
      bases.map((base, i) => [`package-${i}`, { base, imported: "2026-11-14" }]),
    ),
  });

describe("open-twin base for answer keys and eval results", () => {
  test("one commit shared by every package", () => {
    expect(parseOpenTwinBase(upstream([A, A, A]))).toBe(A);
  });

  test("packages at different commits, or none, are refused", () => {
    expect(() => parseOpenTwinBase(upstream([A, B]))).toThrow("one open-twin commit");
    expect(() => parseOpenTwinBase(upstream([]))).toThrow("one open-twin commit");
    expect(() => parseOpenTwinBase(upstream(["main"]))).toThrow("one open-twin commit");
  });

  test("the committed UPSTREAM.json names one commit", () => {
    expect(openTwinBase()).toMatch(/^[0-9a-f]{40}$/);
  });
});
