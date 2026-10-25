import { describe, expect, test } from "bun:test";

import { CLOUD_CONNECT_SHAPE_PENDING, parseCloudConnectExport } from "./push";

describe("cloud_connect parser", () => {
  test("is marked pending VUSE XR answer 3", () => {
    expect(() => parseCloudConnectExport({ auth: ["a", "b"] })).toThrow(
      CLOUD_CONNECT_SHAPE_PENDING,
    );
  });
});
