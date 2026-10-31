import { describe, expect, test } from "bun:test";

import { createSkipThrottle, SKIP_AUDIT_WINDOW_MS } from "./skip-throttle";

describe("locked-skip throttle (#341)", () => {
  test("one row per key per 10 minutes, keys counted apart", () => {
    let clock = 1_000;
    const allow = createSkipThrottle({ now: () => clock });
    expect(SKIP_AUDIT_WINDOW_MS).toBe(600_000);
    expect(allow("conn-a")).toBe(true);
    expect(allow("conn-a")).toBe(false);
    expect(allow("conn-b")).toBe(true);
    clock += SKIP_AUDIT_WINDOW_MS - 1;
    expect(allow("conn-a")).toBe(false);
    clock += 1;
    expect(allow("conn-a")).toBe(true);
    expect(allow("conn-a")).toBe(false);
  });
});
