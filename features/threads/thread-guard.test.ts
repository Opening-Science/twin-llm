import { describe, expect, test } from "bun:test";

import { runThreadGuard, threadResponseFor } from "./thread-guard";

const page = new Request("http://localhost/t/abc");

describe("runThreadGuard", () => {
  test("does nothing without a configured check", async () => {
    expect(await runThreadGuard(null, page)).toBeNull();
  });

  test("allows, and fails open when the check is unavailable", async () => {
    expect(await runThreadGuard(async () => ({ kind: "allowed" }), page)).toBeNull();
    expect(
      await runThreadGuard(async () => ({ kind: "unavailable", detail: "down" }), page),
    ).toBeNull();
  });

  test("answers a rate limit with 429 and a block with 403", async () => {
    const limited = threadResponseFor({ kind: "rate-limited", resetAt: null });
    expect(limited?.status).toBe(429);
    expect(await limited?.text()).toBe("Too many requests. Try again shortly.");
    const blocked = threadResponseFor({ kind: "blocked" });
    expect(blocked?.status).toBe(403);
    expect(await blocked?.text()).toBe("This request was blocked.");
  });
});
