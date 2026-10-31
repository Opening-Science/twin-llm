import { describe, expect, test } from "bun:test";

import { createTtlCache } from "./cache";

describe("createTtlCache", () => {
  test("returns a value until its time runs out", () => {
    const clock = { now: 1000 };
    const cache = createTtlCache<string>({
      ttlMs: 50,
      maxEntries: 5,
      now: () => clock.now,
    });
    cache.set("a", "one");
    clock.now = 1049;
    expect(cache.get("a")).toBe("one");
    clock.now = 1050;
    expect(cache.get("a")).toBe(undefined);
    expect(cache.size()).toBe(0);
  });

  test("drops the oldest entry past the cap", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 3);
    cache.set("c", 4);
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([3, undefined, 4]);
  });
});
