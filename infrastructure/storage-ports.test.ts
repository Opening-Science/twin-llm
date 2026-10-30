import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureOwnerDir, ownUid, statFacts, walkFacts } from "./storage-ports";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "storage-ports-"));
  await mkdir(join(root, "mesh/user-a"), { recursive: true });
  await chmod(join(root, "mesh"), 0o700);
  await chmod(join(root, "mesh/user-a"), 0o750);
  await writeFile(join(root, "mesh/user-a/one.glb"), "synthetic", { mode: 0o600 });
  await writeFile(join(root, "mesh/user-a/two.glb"), "synthetic", { mode: 0o644 });
  await chmod(join(root, "mesh/user-a/two.glb"), 0o644);
  await symlink("/etc/hostname", join(root, "mesh/link"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("statFacts", () => {
  test("mode, owner and kind; missing as its own kind", async () => {
    expect(await statFacts(join(root, "mesh"))).toEqual({
      kind: "found",
      mode: 0o700,
      uid: ownUid(),
      directory: true,
    });
    expect(await statFacts(join(root, "nope"))).toEqual({ kind: "missing" });
  });
});

describe("walkFacts", () => {
  test("every entry below, symlinks skipped", async () => {
    const walked = await walkFacts(join(root, "mesh"));
    expect(walked.truncated).toBe(false);
    const modes = (walked.files ?? [])
      .map((facts) => (facts.kind === "found" ? facts.mode : -1))
      .sort();
    expect(modes).toEqual([0o600, 0o644, 0o750].sort());
  });

  test("a missing folder has no entries; the limit truncates", async () => {
    expect(await walkFacts(join(root, "missing"))).toEqual({
      files: [],
      truncated: false,
    });
    const limited = await walkFacts(join(root, "mesh"), 1);
    expect(limited).toMatchObject({ truncated: true });
    expect(limited.files).toHaveLength(1);
  });
});

describe("ensureOwnerDir", () => {
  test("creates the folder 0700 whatever the umask", async () => {
    const previous = process.umask(0o022);
    try {
      await ensureOwnerDir(join(root, "state/nested"));
    } finally {
      process.umask(previous);
    }
    expect(await statFacts(join(root, "state/nested"))).toMatchObject({ mode: 0o700 });
  });
});
