import { describe, expect, test } from "bun:test";

import { ATLAS_IDS, ATLASES, atlasApiUrl, atlasVersion, isAtlasId } from "./manifest";

describe("ATLASES", () => {
  test("every pinned atlas is complete and consistent", () => {
    expect(Object.keys(ATLASES)).toEqual([...ATLAS_IDS]);
    for (const id of ATLAS_IDS) {
      const entry = ATLASES[id];
      expect(entry.id).toBe(id);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.url).toBe(`https://opentwin.opening.science/models/${entry.fileName}`);

      expect(entry.licenceUrl).toBe("https://creativecommons.org/licenses/by/4.0/");
      expect(entry.mirrorX).toBe(false);
    }
  });

  test("pins match the spike measurements", () => {
    expect(ATLASES.bodyparts3d.bytes).toBe(10_333_316);
    expect(ATLASES["hra-f"].bytes).toBe(15_388_344);
    expect(ATLASES["hra-m"].bytes).toBe(8_489_716);
  });

  test("credits are the verbatim open-twin-xr attribution strings", () => {
    expect(ATLASES.bodyparts3d.attribution).toBe(
      "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.",
    );
    const hra =
      "3D anatomical structures from the HuBMAP Human Reference Atlas (HRA), humanatlas.io, CC BY 4.0.";
    expect(ATLASES["hra-f"].attribution).toBe(hra);
    expect(ATLASES["hra-m"].attribution).toBe(hra);
  });

  test("version and API url derive from the pin", () => {
    expect(atlasVersion("bodyparts3d")).toBe("a65116b5ac9e33f3");
    expect(atlasApiUrl("hra-m")).toBe("/api/anatomy/atlas/hra-m?v=5d820f289a529ef6");
  });

  test("isAtlasId accepts only the closed set", () => {
    expect(isAtlasId("hra-f")).toBe(true);
    expect(isAtlasId("hra")).toBe(false);
    expect(isAtlasId("../../etc/passwd")).toBe(false);
    expect(isAtlasId(3)).toBe(false);
  });
});
