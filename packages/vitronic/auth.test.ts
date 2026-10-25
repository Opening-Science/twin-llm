import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { secretsEqual } from "./auth";

describe("upload auth compare", () => {
  test("accepts matching secrets", () => {
    expect(secretsEqual("shared-secret", "shared-secret")).toBe(true);
  });

  test("rejects a different secret", () => {
    expect(secretsEqual("shared-secret", "other")).toBe(false);
  });

  test("digest length is independent of input length", () => {
    const left = createHash("sha256").update("a").digest();
    const right = createHash("sha256").update("bbbb").digest();
    expect(left.byteLength).toBe(right.byteLength);
  });
});
