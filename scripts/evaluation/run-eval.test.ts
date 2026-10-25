import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileCacheStore } from "./run-eval";

/** The real cache store on a temporary directory; no model, no database. */

const dirs: string[] = [];

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "twin-llm-eval-cache-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("fileCacheStore", () => {
  const key = "c".repeat(64);

  test("writes through a temporary file and leaves only <key>.json", async () => {
    const dir = await tempDir();
    const store = fileCacheStore(join(dir, "cache"), 4242);

    expect(await store.read(key)).toBeNull();
    await store.write(key, '{"first":true}');
    await store.write(key, '{"second":true}');

    expect(await readdir(join(dir, "cache"))).toEqual([`${key}.json`]);
    expect(await store.read(key)).toBe('{"second":true}');
    expect(await readFile(join(dir, "cache", `${key}.json`), "utf8")).toBe(
      '{"second":true}',
    );
  });
});
