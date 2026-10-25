import { describe, expect, test } from "bun:test";

import { atlasFilePath, demoBodyFilePath, resolveAnatomyDir } from "./paths";

describe("anatomy paths", () => {
  test("defaults to data/anatomy under the working directory", () => {
    expect(resolveAnatomyDir(null, "/repo")).toBe("/repo/data/anatomy");
    expect(resolveAnatomyDir("", "/repo")).toBe("/repo/data/anatomy");
  });

  test("an env value is resolved against the working directory", () => {
    expect(resolveAnatomyDir("/srv/atlases", "/repo")).toBe("/srv/atlases");
    expect(resolveAnatomyDir("cache/atlases", "/repo")).toBe("/repo/cache/atlases");
  });

  test("file names come from the manifest", () => {
    expect(atlasFilePath("/repo/data/anatomy", "hra-f")).toBe(
      "/repo/data/anatomy/hra.ao.glb",
    );
    expect(atlasFilePath("/repo/data/anatomy", "bodyparts3d")).toBe(
      "/repo/data/anatomy/bodyparts3d.ao.glb",
    );
  });

  test("demo bodies sit in the same dir", () => {
    expect(demoBodyFilePath("/repo/data/anatomy", "anny-adult-f")).toBe(
      "/repo/data/anatomy/anny-adult-f.pose-bodyparts3d.glb",
    );
  });
});
