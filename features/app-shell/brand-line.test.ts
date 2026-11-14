import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { FOUNDATION_NAME, FOUNDATION_URL, LOCKUP } from "./brand-line";

const ROOT = join(import.meta.dir, "../..");

const sha256 = (path: string): string =>
  createHash("sha256")
    .update(readFileSync(join(ROOT, path)))
    .digest("hex");

/** The SHA-256 of each lockup as PROVENANCE.md records it. */
const recordedHash = (path: string): string | null => {
  const provenance = readFileSync(join(ROOT, "PROVENANCE.md"), "utf8");
  const row = provenance.split("\n").find((line) => line.includes(`\`${path}\``));
  return row?.match(/`([0-9a-f]{64})`/)?.[1] ?? null;
};

describe("brand line", () => {
  test("names the foundation in full and links to it", () => {
    expect(FOUNDATION_NAME).toBe("Open Science Foundation");
    expect(FOUNDATION_URL).toBe("https://opening.science");
  });

  test("keeps the lockup's proportions", () => {
    expect([LOCKUP.width, LOCKUP.height]).toEqual([120, 55]);
  });

  test("serves the brand guide's files unmodified", () => {
    for (const src of [LOCKUP.positive, LOCKUP.negative]) {
      const path = `public${src}`;
      expect([path, sha256(path)]).toEqual([path, recordedHash(path) ?? "not recorded"]);
    }
  });
});
