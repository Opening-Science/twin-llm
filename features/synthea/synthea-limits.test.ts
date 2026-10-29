import { describe, expect, test } from "bun:test";

import { clientAddress, createRateLimiter } from "./synthea-limits";

describe("createRateLimiter", () => {
  test("allows `limit` runs per window per address", () => {
    const clock = { at: 0 };
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: () => clock.at,
    });
    expect(limiter.take("a")).toEqual({ ok: true });
    clock.at = 10_000;
    expect(limiter.take("a")).toEqual({ ok: true });
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterS: 50 });
    expect(limiter.take("b")).toEqual({ ok: true });
    clock.at = 60_000;
    expect(limiter.take("a")).toEqual({ ok: true });
    expect(limiter.take("a")).toEqual({ ok: false, retryAfterS: 10 });
  });
});

describe("clientAddress", () => {
  test("prefers X-Real-IP, then the last forwarded hop", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
    expect(
      clientAddress(new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" })),
    ).toBe("203.0.113.7");
    expect(clientAddress(new Headers())).toBe("direct");
  });
});
