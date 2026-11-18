import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Scans of people never go into git (#614, docs/vitronic-reference-scans.md).
 * A mesh or point cloud in the tree, sealed or not, is refused outright; the synthetic mesh the
 * tests need is built in code (`packages/vitronic/tiny-glb.ts`), so none is
 * allowed here. BodyLoop measurement exports are refused under any name that
 * says what they are.
 */
const REPO = join(import.meta.dir, "../..");

const SCAN_FILE = /\.(glb|glb\.enc|gltf|ply|obj|stl|fbx|usdz|e57|pcd|las|laz)$/i;
const MEASUREMENT_EXPORT = /(^|\/)(measurements|viatar[-_]?\d*|bodyloop[^/]*)\.json$/i;

const tracked = (): string[] =>
  Bun.spawnSync(["git", "ls-files", "-z"], { cwd: REPO })
    .stdout.toString()
    .split("\0")
    .filter((file) => file !== "");

describe("no scans in git", () => {
  test("git tracks files at all here", () => {
    expect(tracked().length).toBeGreaterThan(100);
  });

  test("no mesh or point cloud is tracked", () => {
    expect(tracked().filter((file) => SCAN_FILE.test(file))).toEqual([]);
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
