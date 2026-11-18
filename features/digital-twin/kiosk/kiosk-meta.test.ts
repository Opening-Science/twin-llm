import { describe, expect, test } from "bun:test";

import { KIOSK_METADATA } from "./kiosk-meta";

describe("KIOSK_METADATA", () => {
  test("keeps the kiosk out of search engines", () => {
    expect(KIOSK_METADATA.robots).toEqual({ index: false, follow: false });
  });

  test("names the page as the kiosk", () => {
    expect(KIOSK_METADATA.title).toBe("Kiosk · TwinLLM");
  });
});
