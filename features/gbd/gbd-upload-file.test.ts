import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { sha256Of } from "@/packages/gbd-local/import-chunks";

import { removeUpload, saveUpload, uploadChunks } from "./gbd-upload-file";

/** The upload folder in a throwaway directory; the text is made up. */

const ROOT = mkdtempSync(join(tmpdir(), "twinllm-gbd-upload-test-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const streamOf = (...parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      parts.forEach((part) => controller.enqueue(new TextEncoder().encode(part)));
      controller.close();
    },
  });

describe("saveUpload (#426)", () => {
  test("writes the stream to an owner-only file and hashes it on the way", async () => {
    const dir = join(ROOT, "a");
    const saved = await saveUpload(streamOf("made,up\n", "1,2\n"), 1000, dir);
    if (!saved.ok) throw new Error(saved.reason);
    expect([saved.bytes, saved.sha256]).toEqual([
      12,
      sha256Of(new TextEncoder().encode("made,up\n1,2\n")),
    ]);
    expect(readFileSync(saved.path, "utf8")).toBe("made,up\n1,2\n");
    expect([statSync(dir).mode & 0o777, statSync(saved.path).mode & 0o777]).toEqual([
      0o700, 0o600,
    ]);
    const chunks: string[] = [];
    for await (const chunk of uploadChunks(saved.path)) {
      chunks.push(new TextDecoder().decode(chunk));
    }
    expect(chunks.join("")).toBe("made,up\n1,2\n");
    await removeUpload(saved.path);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("stops past the limit and leaves no file", async () => {
    const dir = join(ROOT, "b");
    expect(await saveUpload(streamOf("12345", "67890"), 8, dir)).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("an empty body leaves no file", async () => {
    const dir = join(ROOT, "c");
    expect(await saveUpload(streamOf(), 8, dir)).toEqual({ ok: false, reason: "empty" });
    expect(readdirSync(dir)).toEqual([]);
  });
});
