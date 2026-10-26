import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { cohortContentSha256, contentSha256 } from "./cohort-checksum";

const FIXTURE_DIR = join(import.meta.dir, "../../tests/fixtures/synthea");

/** `sha256sum *.json | LC_ALL=C sort | sha256sum` over the four fixture bundles. */
const FIXTURE_SHA256 = "0d39fa6e140a4a0438f02fb39ca71e7dd286ff8d83b861d4ebf9b04eb8d3009e";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("contentSha256", () => {
  test("matches the committed checksum of tests/fixtures/synthea", async () => {
    expect(await cohortContentSha256(FIXTURE_DIR)).toBe(FIXTURE_SHA256);
  });

  test("equals the shell pipeline from generate-local.sh", async () => {
    const run = Bun.spawnSync(
      [
        "bash",
        "-c",
        "set -euo pipefail; cd \"$1\" && shasum -a 256 -- *.json | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'",
        "checksum",
        FIXTURE_DIR,
      ],
      { timeout: 10_000 },
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString().trim()).toBe(await cohortContentSha256(FIXTURE_DIR));
  });

  test("does not depend on the order the files are listed in", () => {
    const a = { name: "a.json", bytes: bytes("{}") };
    const b = { name: "b.json", bytes: bytes("[]") };
    expect(contentSha256([a, b])).toBe(contentSha256([b, a]));
  });

  test("changes when a file's bytes or name change, and ignores non-JSON files", () => {
    const a = { name: "a.json", bytes: bytes("{}") };
    const base = contentSha256([a]);
    expect(contentSha256([{ ...a, bytes: bytes("{ }") }])).not.toBe(base);
    expect(contentSha256([{ ...a, name: "c.json" }])).not.toBe(base);
    expect(contentSha256([a, { name: "manifest.txt", bytes: bytes("x") }])).toBe(base);
  });
});
