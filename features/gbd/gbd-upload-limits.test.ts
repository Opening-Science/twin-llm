import { describe, expect, test } from "bun:test";

import {
  GBD_FREE_SPACE_MARGIN_BYTES,
  GBD_MAX_UPLOAD_BYTES,
  gbdUploadHasRoom,
} from "./gbd-upload-limits";

const MB = 1024 * 1024;

describe("GBD upload limits (#434)", () => {
  test("the cap is 1 GB and the margin 1 GB", () => {
    expect([GBD_MAX_UPLOAD_BYTES, GBD_FREE_SPACE_MARGIN_BYTES]).toEqual([
      1024 * MB,
      1024 * MB,
    ]);
  });

  test("a file fits when the margin is left after it", () => {
    const margin = GBD_FREE_SPACE_MARGIN_BYTES;
    expect(gbdUploadHasRoom(margin + 300 * MB, 300 * MB)).toBe(true);
    expect(gbdUploadHasRoom(margin + 300 * MB - 1, 300 * MB)).toBe(false);
  });

  test("an undeclared size still needs the margin", () => {
    expect(gbdUploadHasRoom(GBD_FREE_SPACE_MARGIN_BYTES, null)).toBe(true);
    expect(gbdUploadHasRoom(GBD_FREE_SPACE_MARGIN_BYTES - 1, null)).toBe(false);
  });

  test("free space that cannot be told does not refuse", () => {
    expect(gbdUploadHasRoom(null, 900 * MB)).toBe(true);
  });
});
