/**
 * Regenerates the evaluation cohort in a temporary folder, under another time
 * zone, and checks it is the pinned one (`EVAL_CONTENT_SHA256`). Needs Java 21+
 * and a few minutes, so it runs only with RUN_LIVE=1:
 *
 *   RUN_LIVE=1 bun test scripts/synthea/reproducible.live.test.ts
 *
 * The JAR is reused from `.synthea/cache` when it is there, else downloaded
 * (and checked) by the script. `.synthea/fhir` is never touched.
 *
 * The pin was made on Linux x86_64. Synthea's java.lang.Math gives a few last
 * digits differently on other CPU architectures (an Apple Silicon Mac gets the
 * same people with another checksum), so it is skipped there; such machines
 * download the pinned files instead (docs/warehouse.md, "Reproducible runs").
 */
import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cohortContentSha256 } from "./cohort-checksum";
import { COHORT_PRESETS, EVAL_CONTENT_SHA256 } from "./cohort-presets";

// RUN_LIVE is a test-runner switch, not app config, so it is read here rather
// than through infrastructure/env.ts, the same exception as
// evaluation/answer-key.test.ts.
const runLive = Bun.env.RUN_LIVE === "1";
const skip = !runLive || process.arch !== "x64";

const REPO = join(import.meta.dir, "../..");
const JAR = ".synthea/cache/synthea-with-dependencies.jar";

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

describe.skipIf(skip)("the evaluation cohort regenerates (RUN_LIVE=1)", () => {
  test("another folder and time zone give the pinned checksum", async () => {
    const root = await mkdtemp(join(tmpdir(), "twin-llm-synthea-"));
    try {
      // The script works from its own checkout root, so give it one.
      await mkdir(join(root, "scripts/synthea"), { recursive: true });
      for (const file of ["generate-local.sh", "synthea-pin.sh"]) {
        await copyFile(join(import.meta.dir, file), join(root, "scripts/synthea", file));
      }
      if (await exists(join(REPO, JAR))) {
        await mkdir(join(root, ".synthea/cache"), { recursive: true });
        await copyFile(join(REPO, JAR), join(root, JAR));
      }
      const run = Bun.spawn(
        ["bash", "scripts/synthea/generate-local.sh", "--preset", "eval"],
        {
          cwd: root,
          env: {
            PATH: Bun.env.PATH ?? "",
            HOME: Bun.env.HOME ?? root,
            TZ: "America/New_York",
          },
          stdout: "ignore",
          stderr: "inherit",
        },
      );
      expect(await run.exited).toBe(0);

      const out = join(root, COHORT_PRESETS.eval.out);
      const manifest = JSON.parse(
        await readFile(join(out, "manifest.json"), "utf8"),
      ) as unknown;
      expect(Reflect.get(manifest as object, "contentSha256")).toBe(EVAL_CONTENT_SHA256);
      expect(await cohortContentSha256(join(out, "fhir"))).toBe(EVAL_CONTENT_SHA256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 900_000);
});
