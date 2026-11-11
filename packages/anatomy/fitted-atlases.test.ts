import { describe, expect, test } from "bun:test";

import { DEMO_BODY_IDS } from "./demo-bodies";
import {
  FITTED_ATLAS_IDS,
  FITTED_ATLASES,
  fittedAtlasApiUrl,
  fittedAtlasEntry,
  isFittedAtlasId,
  splitFittedAtlasId,
} from "./fitted-atlases";
import { ATLAS_IDS, ATLASES } from "./manifest";
import { fittedAtlasFilePath } from "./paths";

const SHA256 = /^[0-9a-f]{64}$/;
const entries = DEMO_BODY_IDS.flatMap((body) =>
  ATLAS_IDS.map((atlas) => FITTED_ATLASES[body][atlas]),
);

describe("fitted atlas pins", () => {
  test("one pin per rigged demo body × atlas, each with its own bytes", () => {
    expect(entries).toHaveLength(DEMO_BODY_IDS.length * ATLAS_IDS.length);
    for (const entry of entries) {
      expect(entry.sha256).toMatch(SHA256);
      expect(entry.sourceSha256).toMatch(SHA256);
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.fileName).toBe(
        `${entry.bodyId}.${entry.atlasId}.fitted.quantised.glb`,
      );
      expect(entry.sourceFileName).toBe(`${entry.bodyId}.${entry.atlasId}.fitted.glb`);
    }
    expect(new Set(entries.map((entry) => entry.sha256)).size).toBe(entries.length);
  });

  test("quantised files are smaller than Blender's and no bigger than the pinned atlas", () => {
    for (const entry of entries) {
      expect(entry.bytes).toBeLessThan(entry.sourceBytes * 0.7);
      expect(entry.bytes).toBeLessThanOrEqual(ATLASES[entry.atlasId].bytes);
      expect(entry.bytes).toBeGreaterThan(ATLASES[entry.atlasId].bytes * 0.8);
    }
  });
});

describe("fitted atlas ids", () => {
  test("are `<body>.<atlas>` from a closed list", () => {
    expect(FITTED_ATLAS_IDS).toContain("anny-adult-f.hra-f");
    expect(FITTED_ATLAS_IDS).toHaveLength(6);
    expect(splitFittedAtlasId("anny-adult-m.bodyparts3d")).toEqual({
      bodyId: "anny-adult-m",
      atlasId: "bodyparts3d",
    });
    expect(fittedAtlasEntry("anny-adult-m.hra-f")).toBe(
      FITTED_ATLASES["anny-adult-m"]["hra-f"],
    );
  });

  test("anything else is not an id", () => {
    for (const value of [
      "hra-f",
      "anny-adult-m",
      "anny-adult-m.",
      "anny-adult-m.hra-x",
      "../anny-adult-m.hra-f",
      "anny-adult-m.hra-f/..",
      42,
      null,
    ]) {
      expect(isFittedAtlasId(value)).toBe(false);
    }
  });

  test("the URL carries the pinned version and the file sits in fitted/", () => {
    const pin = FITTED_ATLASES["anny-adult-f"].bodyparts3d;
    expect(fittedAtlasApiUrl("anny-adult-f", "bodyparts3d")).toBe(
      `/api/anatomy/fitted/anny-adult-f.bodyparts3d?v=${pin.sha256.slice(0, 16)}`,
    );
    expect(fittedAtlasFilePath("/data/anatomy", "anny-adult-f", "bodyparts3d")).toBe(
      "/data/anatomy/fitted/anny-adult-f.bodyparts3d.fitted.quantised.glb",
    );
  });
});
