import { describe, expect, test } from "bun:test";

import { GlbTooLargeError, MAX_GLB_BYTES, readBoundedBytes } from "./glb";

describe("readBoundedBytes", () => {
  test("rejects a body over the 100 MiB cap", async () => {
    const response = new Response("x", {
      headers: { "content-length": String(MAX_GLB_BYTES + 1) },
    });
    await expect(readBoundedBytes(response)).rejects.toBeInstanceOf(GlbTooLargeError);
  });
});
