import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createFileHasher, fileHashKey } from "./file-hash";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

const dir = { path: "" };

beforeAll(async () => {
  dir.path = await mkdtemp(join(tmpdir(), "lab-file-hash-"));
});

afterAll(async () => {
  await rm(dir.path, { recursive: true, force: true });
});

describe("fileHashKey", () => {
  test("a different change time is a different key", () => {
    const base = { dev: 1, ino: 2, size: 3, mtimeMs: 4, ctimeMs: 5 };
    expect(fileHashKey("a", base)).not.toBe(fileHashKey("a", { ...base, ctimeMs: 6 }));
    expect(fileHashKey("a", base)).not.toBe(fileHashKey("a", { ...base, ino: 9 }));
  });
});

describe("createFileHasher", () => {
  test("hashes a file and reports a missing one", async () => {
    const path = join(dir.path, "one.txt");
    await writeFile(path, "hello");
    const hash = createFileHasher();
    expect(await hash(path)).toEqual({ kind: "hash", sha256: sha("hello") });
    expect(await hash(join(dir.path, "nope.txt"))).toEqual({ kind: "missing" });
  });

  test.skipIf(process.getuid?.() === 0)(
    "a file it cannot read is unreadable, not an error",
    async () => {
      const path = join(dir.path, "locked.txt");
      await writeFile(path, "secret bytes");
      await chmod(path, 0o000);
      try {
        expect(await createFileHasher()(path)).toEqual({ kind: "unreadable" });
      } finally {
        await chmod(path, 0o600);
      }
    },
  );

  test("a same-size replacement with its old mtime restored is hashed again", async () => {
    const path = join(dir.path, "swap.txt");
    await writeFile(path, "aaaa");
    const before = await stat(path);
    const hash = createFileHasher();
    expect(await hash(path)).toEqual({ kind: "hash", sha256: sha("aaaa") });
    await Bun.sleep(20);
    await writeFile(path, "bbbb");
    await utimes(path, before.atime, before.mtime);
    expect(await hash(path)).toEqual({ kind: "hash", sha256: sha("bbbb") });
  });

  test("two reads at once share one hash, and the result expires", async () => {
    const path = join(dir.path, "shared.txt");
    await writeFile(path, "x");
    const clock = { now: 0 };
    const calls: string[] = [];
    const hash = createFileHasher({
      ttlMs: 1000,
      now: () => clock.now,
      hashFile: async (file) => {
        calls.push(file);
        await Bun.sleep(5);
        return "f".repeat(64);
      },
    });
    const [first, second] = await Promise.all([hash(path), hash(path)]);
    expect(first).toEqual(second);
    expect(calls.length).toBe(1);
    await hash(path);
    expect(calls.length).toBe(1);
    clock.now = 1001;
    await hash(path);
    expect(calls.length).toBe(2);
  });

  test("a failed read is not cached", async () => {
    const path = join(dir.path, "flaky.txt");
    await writeFile(path, "x");
    const calls = { count: 0 };
    const hash = createFileHasher({
      hashFile: async () => {
        calls.count += 1;
        if (calls.count === 1) throw new Error("EACCES");
        return "e".repeat(64);
      },
    });
    expect(await hash(path)).toEqual({ kind: "unreadable" });
    expect(await hash(path)).toEqual({ kind: "hash", sha256: "e".repeat(64) });
  });
});
