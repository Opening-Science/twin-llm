import { describe, expect, test } from "bun:test";

import {
  artefactResult,
  type PinnedArtefact,
  pinnedArtefacts,
  pinnedArtefactsCheck,
} from "./pinned-artefacts-check";

const A = "a".repeat(64);
const B = "b".repeat(64);

const pin = (
  id: string,
  onMismatch: PinnedArtefact["onMismatch"] = "not-ok",
): PinnedArtefact => ({
  id,
  name: `File ${id}`,
  path: `data/${id}.bin`,
  expectedSha256: A,
  onMismatch,
});

describe("artefactResult", () => {
  test("compares case-insensitively and reports a missing file", () => {
    expect(artefactResult(A, A.toUpperCase())).toBe("matches");
    expect(artefactResult(A, B)).toBe("differs");
    expect(artefactResult(A, null)).toBe("not present");
  });
});

describe("pinnedArtefacts", () => {
  test("lists the Synthea JAR, the cohort archive and seven anatomy files", () => {
    const pins = pinnedArtefacts({
      syntheaJar: ".synthea/cache/synthea-with-dependencies.jar",
      syntheaDownloads: ".synthea/downloads",
      anatomy: "data/anatomy",
    });
    expect(pins.map((entry) => entry.path)).toEqual([
      ".synthea/cache/synthea-with-dependencies.jar",
      ".synthea/downloads/eval-cohort-synthea-v4-seed42-20260101.tar.zst",
      "data/anatomy/bodyparts3d.ao.glb",
      "data/anatomy/hra.ao.glb",
      "data/anatomy/hra-m.ao.glb",
      "data/anatomy/anny-adult-m.pose-bodyparts3d.glb",
      "data/anatomy/anny-adult-f.pose-bodyparts3d.glb",
      "data/anatomy/anny-adult-m.rigged.glb",
      "data/anatomy/anny-adult-f.rigged.glb",
    ]);
    expect(pins[0].expectedSha256).toBe(
      "ed43c20ad40ba5c3bc724503a5af032715fe3c491620b766148e7c2361e6ecc1",
    );
    expect(pins[1].expectedSha256).toBe(
      "45d84cad9882f9fe7365f42b7bc64b6cedcc6665a412c88a8e56e612712c2b14",
    );
    expect(pins.filter((entry) => entry.onMismatch === "unknown").length).toBe(2);
  });
});

describe("pinnedArtefactsCheck", () => {
  test("nothing present is unknown", () => {
    const check = pinnedArtefactsCheck([pin("x")], { x: null });
    expect(check.status).toBe("unknown");
    expect(check.summary).toBe("None of the pinned files is on this machine yet.");
    expect(check.table?.rows).toEqual([
      ["File x", "aaaaaaaaaaaa", "—", "Not on this machine"],
    ]);
  });

  test("present files that match are ok, missing ones are counted", () => {
    const check = pinnedArtefactsCheck([pin("x"), pin("y")], { x: A, y: null });
    expect(check.status).toBe("ok");
    expect(check.summary).toBe(
      "Files on this machine that match their pins: 1 of 1. Not on this machine: 1 file.",
    );
  });

  test("a changed file is not ok and named", () => {
    const check = pinnedArtefactsCheck([pin("x"), pin("y")], { x: A, y: B });
    expect(check.status).toBe("not-ok");
    expect(check.summary).toBe(
      "Files on this machine that match their pins: 1 of 2. Different bytes: File y.",
    );
  });

  test("a rigged body that differs is unknown, not a failure", () => {
    const check = pinnedArtefactsCheck([pin("x"), pin("r", "unknown")], { x: A, r: B });
    expect(check.status).toBe("unknown");
  });

  test("a folder outside the repository is written as its variable", () => {
    const check = pinnedArtefactsCheck(
      [{ ...pin("x"), path: "$ANATOMY_DATA_DIR/x.glb" }],
      {},
    );
    expect(check.howTo).toBe("sha256sum $ANATOMY_DATA_DIR/x.glb");
  });

  test("the command lists every path and quotes odd ones", () => {
    const check = pinnedArtefactsCheck(
      [pin("x"), { ...pin("y"), path: "/home/a b/y.bin" }],
      {},
    );
    expect(check.howTo).toBe("sha256sum data/x.bin \\\n  '/home/a b/y.bin'");
  });
});
