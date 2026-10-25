import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseModelsResponse, pickGlbModel } from "./models";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/models-flat.json"), "utf8"),
) as Record<string, string>;

describe("BodyLoop models map", () => {
  test("parses the 0.13.7 flat filename map and prefers avatar_3d.glb", () => {
    const map = parseModelsResponse(fixture);
    expect(Object.keys(map)).toEqual([
      "coarse_pointcloud_3d.ply",
      "mesh_3d.glb",
      "avatar_3d.glb",
      "avatar_3d.obj",
      "avatar_3d.stl",
      "avatar_3d.ply",
      "view.glb",
    ]);
    expect(JSON.stringify(fixture)).not.toContain("/viatars/22/");
    expect(pickGlbModel(Object.keys(map))).toBe("avatar_3d.glb");
  });

  test("flattens the OpenAPI grouped Models shape", () => {
    const map = parseModelsResponse({
      photogrammetry: {
        "view.glb": "/api/v2/viatars/1/models/view.glb",
        "coarse_pointcloud_3d.ply": "/api/v2/viatars/1/models/coarse_pointcloud_3d.ply",
      },
      dataprocessor: {
        "mesh_3d.glb": "/api/v2/viatars/1/models/mesh_3d.glb",
      },
    });
    expect(pickGlbModel(Object.keys(map))).toBe("mesh_3d.glb");
    expect(map["view.glb"]).toBe("/api/v2/viatars/1/models/view.glb");
  });

  test("picks mesh_3d.glb then view.glb and never a non-glb name", () => {
    expect(pickGlbModel(["mesh_3d.glb", "view.glb"])).toBe("mesh_3d.glb");
    expect(pickGlbModel(["view.glb", "avatar_3d.obj"])).toBe("view.glb");
    expect(
      pickGlbModel([
        "coarse_pointcloud_3d.ply",
        "avatar_3d.obj",
        "avatar_3d.stl",
        "avatar_3d.ply",
      ]),
    ).toBeNull();
    expect(pickGlbModel([])).toBeNull();
  });
});
