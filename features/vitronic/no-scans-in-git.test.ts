import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Scans of people never go into git (#614, docs/vitronic-reference-scans.md).
 * Meshes and point clouds are refused except for the pinned, authored glucose
 * particle asset. BodyLoop measurement exports are refused under any name
 * that says what they are.
 */
const REPO = join(import.meta.dir, "../..");
const PARTICLE_ASSET = "data/anatomy/glucose-particles/glucose-particles.glb";
const PARTICLE_ASSET_SHA256 =
  "000834e73f4b008eb81a753a50d924ce52a8564b1cdec10bdb3911f90429d169";

const SCAN_EXTENSIONS = [
  "glb",
  "glb.enc",
  "gltf",
  "ply",
  "obj",
  "stl",
  "fbx",
  "usdz",
  "e57",
  "pcd",
  "las",
  "laz",
] as const;

const SCAN_FILE = new RegExp(
  `\\.(${SCAN_EXTENSIONS.map((extension) => extension.replace(".", "\\.")).join("|")})$`,
  "i",
);
const MEASUREMENT_EXPORT = /(^|\/)(measurements|viatar[-_]?\d*|bodyloop[^/]*)\.json$/i;
const isUnapprovedMesh = (file: string): boolean =>
  SCAN_FILE.test(file) && file !== PARTICLE_ASSET;

const tracked = (): string[] =>
  Bun.spawnSync(["git", "ls-files", "-z"], { cwd: REPO })
    .stdout.toString()
    .split("\0")
    .filter((file) => file !== "");

describe("no scans in git", () => {
  test("git tracks files at all here", () => {
    expect(tracked().length).toBeGreaterThan(100);
  });

  test("no unapproved mesh or point cloud is tracked", () => {
    expect(tracked().filter(isUnapprovedMesh)).toEqual([]);
  });

  test("the approved particle asset matches its pinned hash", () => {
    expect(tracked()).toContain(PARTICLE_ASSET);
    const hash = createHash("sha256")
      .update(readFileSync(join(REPO, PARTICLE_ASSET)))
      .digest("hex");
    expect(hash).toBe(PARTICLE_ASSET_SHA256);
  });

  test("the exception does not allow other meshes or sealed assets", () => {
    expect(isUnapprovedMesh(PARTICLE_ASSET)).toBe(false);
    for (const file of [
      `${PARTICLE_ASSET}.enc`,
      "data/anatomy/glucose-particles/another.glb",
      "data/vitronic/any-user/glucose-particles.glb",
    ])
      expect(isUnapprovedMesh(file)).toBe(true);
  });

  test("no BodyLoop measurement export is tracked", () => {
    expect(tracked().filter((file) => MEASUREMENT_EXPORT.test(file))).toEqual([]);
  });

  test("the scanner's data folder stays ignored", () => {
    const ignored = Bun.spawnSync(
      ["git", "check-ignore", "-q", "data/vitronic/any-user/any.glb"],
      { cwd: REPO },
    );
    expect(ignored.exitCode).toBe(0);
  });

  test("every scan format the tree refuses is ignored anywhere, in any case", () => {
    const mixed = (extension: string) =>
      [...extension]
        .map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char))
        .join("");
    const paths = SCAN_EXTENSIONS.flatMap((extension) =>
      [extension, extension.toUpperCase(), mixed(extension)].map(
        (variant) => `elsewhere/scan.${variant}`,
      ),
    );
    const ignored = Bun.spawnSync(["git", "check-ignore", "--", ...paths], { cwd: REPO })
      .stdout.toString()
      .split("\n")
      .filter((line) => line !== "");
    expect(paths.filter((path) => !ignored.includes(path))).toEqual([]);
  });

  test("a sealed mesh is ignored wherever it lands", () => {
    const ignored = Bun.spawnSync(
      ["git", "check-ignore", "-q", "elsewhere/abc.glb.enc"],
      {
        cwd: REPO,
      },
    );
    expect(ignored.exitCode).toBe(0);
  });
});
