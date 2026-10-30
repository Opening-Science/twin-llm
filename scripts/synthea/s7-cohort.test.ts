import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEMO_COHORTS, isAllowedCohort } from "../../packages/query-tools/scope";
import { contentSha256FromDigests } from "./cohort-checksum";
import { EVALUATION_COHORT_IDS, S7_COHORT_ID } from "./cohort-presets";
import {
  armJavaArgs,
  buildS7Manifest,
  javaRuntimeVersion,
  manifestProblems,
  S7_ARMS,
  S7_MANIFEST_PATH,
  S7_PROPERTIES,
  s7ManifestSchema,
} from "./s7-cohort";

const ROOT = join(import.meta.dir, "../..");
const sha = (text: string | Buffer): string =>
  createHash("sha256").update(text).digest("hex");
const committed = s7ManifestSchema.parse(
  JSON.parse(readFileSync(join(ROOT, S7_MANIFEST_PATH), "utf8")) as unknown,
);

describe("the S7 cohort recipe", () => {
  test("one keep-module run per arm, with the eval cohort's run settings", () => {
    const [af] = S7_ARMS;
    expect(
      af === undefined
        ? []
        : armJavaArgs(af, { jar: "/j.jar", properties: "/p", keepModule: "/k.json" }),
    ).toEqual([
      "-Duser.timezone=UTC",
      "-jar",
      "/j.jar",
      "-c",
      "/p",
      "-s",
      "2770",
      "-cs",
      "2771",
      "-p",
      "10",
      "-r",
      "20260101",
      "-e",
      "20260101",
      "-a",
      "65-90",
      "-k",
      "/k.json",
      "-m",
      "wellness_encounters:allergies:med_rec:atrial_fibrillation:stroke:dementia:hypertension:stable_ischemic_heart_disease:myocardial_infarction:congestive_heart_failure",
      "Massachusetts",
    ]);
  });

  test("the properties are generate-local.sh's, byte for byte (the eval cohort's configSha256)", () => {
    expect(sha(S7_PROPERTIES)).toBe(
      "465c563645934f50067594585ba00e03ec61e2295a8a82baae1135144df859bf",
    );
  });

  test("the cohort is an evaluation cohort on the allowlist, never in the Demo", () => {
    expect(S7_COHORT_ID).toBe("synthea-v4-s7");
    expect(isAllowedCohort(S7_COHORT_ID)).toBe(true);
    expect(EVALUATION_COHORT_IDS).toEqual(["synthea-v4-seed42", "synthea-v4-s7"]);
    expect((DEMO_COHORTS as readonly string[]).includes(S7_COHORT_ID)).toBe(false);
  });

  test("reads the Java runtime version", () => {
    expect(
      javaRuntimeVersion("    java.runtime.version = 21.0.12.1+1\n    java.vendor = x"),
    ).toBe("21.0.12.1+1");
    expect(javaRuntimeVersion("nothing here")).toBe("unknown");
  });
});

const file = (name: string, arm: string, text: string) => ({
  name,
  arm,
  bytes: text.length,
  sha256: sha(text),
});

describe("buildS7Manifest and manifestProblems", () => {
  const files = [file("b.json", "sinus", "b"), file("a.json", "af", "a")];
  const manifest = buildS7Manifest({
    configSha256: "c".repeat(64),
    javaVersion: "21",
    keepSha256: {
      "s7-af.json": "1".repeat(64),
      "s7-af-stroke.json": "2".repeat(64),
      "s7-sinus.json": "3".repeat(64),
    },
    files,
  });

  test("sorts the files, counts them per arm and checksums them as the shell does", () => {
    expect(manifest.files.map((each) => each.name)).toEqual(["a.json", "b.json"]);
    expect(manifest.arms.map((arm) => [arm.name, arm.patientFileCount])).toEqual([
      ["af", 1],
      ["af-stroke", 0],
      ["sinus", 1],
    ]);
    expect(manifest.contentSha256).toBe(contentSha256FromDigests(files));
    expect(manifest.archive).toBeUndefined();
  });

  test("a matching folder has no problems; a missing, extra or changed file is named", () => {
    const digests = files.map(({ name, sha256 }) => ({ name, sha256 }));
    expect(manifestProblems(manifest, digests)).toEqual([]);
    const problems = manifestProblems(manifest, [
      { name: "a.json", sha256: sha("A") },
      { name: "c.json", sha256: sha("c") },
    ]);
    expect(problems.slice(0, 3)).toEqual([
      "missing b.json",
      "not in the manifest: c.json",
      "sha256 differs: a.json",
    ]);
    expect(problems[3]).toStartWith("contentSha256 ");
  });
});

describe("the committed manifest", () => {
  test("is the recipe: three arms, 17 people, ages 65 to 90", () => {
    expect(committed.cohortId).toBe("synthea-v4-s7");
    expect(
      committed.arms.map((arm) => [
        arm.name,
        arm.seed,
        arm.population,
        arm.patientFileCount,
      ]),
    ).toEqual([
      ["af", 2770, 10, 10],
      ["af-stroke", 2772, 3, 3],
      ["sinus", 2774, 4, 4],
    ]);
    expect(committed.patientFileCount).toBe(17);
    expect(committed.age).toBe("65-90");
    expect(committed.configSha256).toBe(sha(S7_PROPERTIES));
  });

  test("its contentSha256 is the checksum of its own file list", () => {
    expect(contentSha256FromDigests(committed.files)).toBe(committed.contentSha256);
    expect(committed.contentSha256).toBe(
      "2d8b7a64fb6fff2d7951c8d8640e72ef74ddd72a6bdb75da1fc355fb98d45f14",
    );
  });

  test("records the keep modules as committed", () => {
    expect(
      committed.arms.map((arm) => [
        arm.keep,
        arm.keepSha256 ===
          sha(readFileSync(join(ROOT, "scripts/synthea/keep", arm.keep))),
      ]),
    ).toEqual([
      ["s7-af.json", true],
      ["s7-af-stroke.json", true],
      ["s7-sinus.json", true],
    ]);
  });

  test("pins the release archive", () => {
    expect(committed.archive).toEqual({
      name: "supplementary-cohort-synthea-v4-s7-20260101.tar.zst",
      bytes: 467_351,
      sha256: "cd1f3560513a78055127c90ebf91bad557369bd5dcb3f8123a15a93f6cf746e2",
    });
  });
});
