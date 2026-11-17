import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ATLAS_GROUP_KEYS, type TwinDonor, target3d } from "./atlas-groups";
import { normaliseGroup, systemForGroup } from "./hra-groups";
import { ATLASES } from "./manifest";

/** The pinned atlases, when `bun run anatomy:fetch` has installed them here. */
const ATLAS_DIR = join(import.meta.dir, "../../data/anatomy");

/** Every `anatomical_structure_of` in a GLB's JSON chunk, in node order. */
const groupKeysIn = (path: string): readonly string[] => {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")) as {
    nodes?: readonly { extras?: { anatomical_structure_of?: unknown } }[];
  };
  return (gltf.nodes ?? []).flatMap((node) => {
    const key = node.extras?.anatomical_structure_of;
    return typeof key === "string" && key !== "-" && key !== "" ? [key] : [];
  });
};

describe("ATLAS_GROUP_KEYS against the installed atlases", () => {
  const files: Readonly<Record<TwinDonor, string>> = {
    male: ATLASES["hra-m"].fileName,
    female: ATLASES["hra-f"].fileName,
  };
  for (const donor of ["male", "female"] as const) {
    const path = join(ATLAS_DIR, files[donor]);
    test.skipIf(!existsSync(path))(donor, () => {
      expect(groupKeysIn(path)).toEqual(ATLAS_GROUP_KEYS[donor]);
    });
  }
});

describe("ATLAS_GROUP_KEYS", () => {
  test("holds 50 male and 61 female keys, none twice", () => {
    expect(ATLAS_GROUP_KEYS.male.length).toBe(50);
    expect(ATLAS_GROUP_KEYS.female.length).toBe(61);
    expect(new Set(ATLAS_GROUP_KEYS.male).size).toBe(50);
    expect(new Set(ATLAS_GROUP_KEYS.female).size).toBe(61);
  });

  test("each key belongs to its donor's atlas", () => {
    expect(ATLAS_GROUP_KEYS.male.every((key) => /^#VHM/.test(key))).toBe(true);
    expect(ATLAS_GROUP_KEYS.female.every((key) => /^#+VHF/.test(key))).toBe(true);
  });

  test("every key has a system, except the groups left unmapped on purpose", () => {
    const unmapped = [...ATLAS_GROUP_KEYS.male, ...ATLAS_GROUP_KEYS.female]
      .filter((key) => systemForGroup(key) === null)
      .map(normaliseGroup);
    expect([...new Set(unmapped)].sort()).toEqual(["lymphnode", "palatinetonsil"]);
  });
});

describe("target3d", () => {
  test("names each donor's own key for the same organ", () => {
    expect(target3d(["heart"], "male")).toEqual(["#VHMHeart"]);
    expect(target3d(["heart"], "female")).toEqual(["#VHFHeartV1.1"]);
    expect(target3d(["lung"], "male")).toEqual(["#VHMLungV1.1"]);
    expect(target3d(["lung"], "female")).toEqual(["#VHFLungV1.2"]);
  });

  test("a paired organ gives both sides, in atlas order", () => {
    expect(target3d(["kidney"], "male")).toEqual(["#VHMLeftKidney", "#VHMRightKidney"]);
    expect(target3d(["kidney"], "female")).toEqual([
      "#VHFLeftKidneyV1.1",
      "#VHFRightKidneyV1.1",
    ]);
  });

  test("ducts written tissue first on one atlas only still match their own group", () => {
    expect(target3d(["liver", "liverducts", "ductsliver"], "male")).toEqual([
      "#VHMLiver",
      "#VHMDuctsLiver",
    ]);
    expect(target3d(["liver", "liverducts", "ductsliver"], "female")).toEqual([
      "#VHFLiver",
      "#VHFLiverDucts",
    ]);
  });

  test("is empty where the donor's atlas has no mesh, never a neighbour", () => {
    expect(target3d(["prostate"], "female")).toEqual([]);
    expect(target3d(["prostate"], "male")).toEqual(["#VHMProstate"]);
    expect(target3d(["ovary"], "male")).toEqual([]);
    expect(target3d(["testis"], "male")).toEqual([]);
    expect(target3d(["thyroid"], "female")).toEqual([]);
    expect(target3d([], "male")).toEqual([]);
  });

  test("never targets a hidden group", () => {
    expect(target3d(["placenta"], "female")).toEqual([]);
  });
});
