import { describe, expect, test } from "bun:test";

import { buildTinyGlb } from "./tiny-glb";

describe("tiny glb fixture", () => {
  test("is a glTF 2.0 binary with AutoMarkers in the JSON chunk", () => {
    const bytes = buildTinyGlb();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.byteLength).toBeLessThan(8_192);
    const magic = Buffer.from(bytes.subarray(0, 4)).toString("ascii");
    expect(magic).toBe("glTF");
    const json = Buffer.from(bytes).toString("utf8");
    expect(json).toContain("AutoMarkers");
  });
});
