import { describe, expect, test } from "bun:test";

import { type FileHash } from "./file-hash";
import { unavailableCheck } from "./lab-check";
import {
  artefactResult,
  type PinnedArtefact,
  pinnedArtefacts,
  pinnedArtefactsBase,
  pinnedArtefactsCheck,
  pinnedHowTo,
  shellPath,
} from "./pinned-artefacts-check";

const A = "a".repeat(64);
const B = "b".repeat(64);
const hash = (sha256: string): FileHash => ({ kind: "hash", sha256 });
const MISSING: FileHash = { kind: "missing" };
const UNREADABLE: FileHash = { kind: "unreadable" };

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
    expect(artefactResult(A, hash(A.toUpperCase()))).toBe("matches");
    expect(artefactResult(A, hash(B))).toBe("differs");
    expect(artefactResult(A, MISSING)).toBe("not present");
    expect(artefactResult(A, UNREADABLE)).toBe("unreadable");
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
    const check = pinnedArtefactsCheck([pin("x")], { x: MISSING });
    expect(check.status).toBe("unknown");
    expect(check.summary).toBe("None of the pinned files is on this machine yet.");
    expect(check.table?.rows).toEqual([
      ["File x", "aaaaaaaaaaaa", "—", "Not on this machine"],
    ]);
  });

  test("present files that match are ok, missing ones are counted", () => {
    const check = pinnedArtefactsCheck([pin("x"), pin("y")], { x: hash(A), y: MISSING });
    expect(check.status).toBe("ok");
    expect(check.summary).toBe(
      "Files on this machine that match their pins: 1 of 1. Not on this machine: 1 file.",
    );
  });

  test("a changed file is not ok and named", () => {
    const check = pinnedArtefactsCheck([pin("x"), pin("y")], { x: hash(A), y: hash(B) });
    expect(check.status).toBe("not-ok");
    expect(check.summary).toBe(
      "Files on this machine that match their pins: 1 of 2. Different bytes: File y.",
    );
  });

  test("a rigged body that differs is unknown, not a failure", () => {
    const check = pinnedArtefactsCheck([pin("x"), pin("r", "unknown")], {
      x: hash(A),
      r: hash(B),
    });
    expect(check.status).toBe("unknown");
  });

  test("a file that cannot be read stays in its row and hides no other", () => {
    const check = pinnedArtefactsCheck([pin("x"), pin("y"), pin("z")], {
      x: hash(A),
      y: UNREADABLE,
      z: MISSING,
    });
    expect(check.status).toBe("unknown");
    expect(check.summary).toBe(
      "Files on this machine that match their pins: 1 of 2. Could not read: File y. Check the file's permissions and reload. Not on this machine: 1 file.",
    );
    expect(check.table?.rows).toEqual([
      ["File x", "aaaaaaaaaaaa", "aaaaaaaaaaaa", "Matches"],
      ["File y", "aaaaaaaaaaaa", "—", "Could not read"],
      ["File z", "aaaaaaaaaaaa", "—", "Not on this machine"],
    ]);
  });

  test("a different file still fails next to one that cannot be read", () => {
    const check = pinnedArtefactsCheck([pin("x"), pin("y")], {
      x: hash(B),
      y: UNREADABLE,
    });
    expect(check.status).toBe("not-ok");
  });

  test("a folder outside the repository is read from .env.local into the shell", () => {
    const check = pinnedArtefactsCheck(
      [
        { ...pin("j"), path: "$SYNTHEA_JAR" },
        pin("x"),
        { ...pin("y"), path: "$ANATOMY_DATA_DIR/y.glb" },
      ],
      {},
    );
    expect(check.howTo).toBe(
      [
        "# Reads SYNTHEA_JAR and ANATOMY_DATA_DIR from .env.local without printing; set by hand if not there",
        `SYNTHEA_JAR="$(grep -m1 '^SYNTHEA_JAR=' .env.local | cut -d= -f2- | tr -d "\"'")"`,
        `ANATOMY_DATA_DIR="$(grep -m1 '^ANATOMY_DATA_DIR=' .env.local | cut -d= -f2- | tr -d "\"'")"`,
        'sha256sum "$SYNTHEA_JAR" \\',
        "  data/x.bin \\",
        '  "$ANATOMY_DATA_DIR"/y.glb',
      ].join("\n"),
    );
  });

  test("the command lists every path and quotes odd ones", () => {
    const check = pinnedArtefactsCheck(
      [pin("x"), { ...pin("y"), path: "/home/a b/y.bin" }],
      {},
    );
    expect(check.howTo).toBe("sha256sum data/x.bin \\\n  '/home/a b/y.bin'");
  });

  test("the card that could not run shows the same command", () => {
    const pins = [pin("x"), { ...pin("y"), path: "$ANATOMY_DATA_DIR/y.glb" }];
    expect(unavailableCheck(pinnedArtefactsBase(pins)).howTo).toBe(
      pinnedArtefactsCheck(pins, {}).howTo,
    );
    expect(pinnedArtefactsBase(pins).howTo).toBe(pinnedHowTo(pins));
  });
});

describe("shellPath", () => {
  test("keeps the variable quoted and the rest safe", () => {
    expect(shellPath("$SYNTHEA_JAR")).toBe('"$SYNTHEA_JAR"');
    expect(shellPath("$ANATOMY_DATA_DIR/a b.glb")).toBe(`"$ANATOMY_DATA_DIR"'/a b.glb'`);
    expect(shellPath("data/x.glb")).toBe("data/x.glb");
    expect(shellPath("it's")).toBe(`'it'\\''s'`);
  });
});
