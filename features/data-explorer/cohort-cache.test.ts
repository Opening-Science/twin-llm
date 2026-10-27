import { describe, expect, test } from "bun:test";

import { createCohortCache } from "./cohort-cache";

const counter = () => {
  const loads: string[] = [];
  const load = (value: string) => async () => {
    loads.push(value);
    return value;
  };
  return { loads, load };
};

describe("createCohortCache", () => {
  test("serves a hit while the fingerprint holds and reloads when it changes", async () => {
    const cache = createCohortCache({ ttlMs: 1_000, maxEntries: 10, now: () => 0 });
    const { loads, load } = counter();
    expect(await cache.read("c|a", "10:t1", load("first"))).toBe("first");
    expect(await cache.read("c|a", "10:t1", load("second"))).toBe("first");
    expect(await cache.read("c|a", "11:t2", load("third"))).toBe("third");
    expect(loads).toEqual(["first", "third"]);
  });

  test("an entry older than the TTL is read again", async () => {
    let clock = 0;
    const cache = createCohortCache({ ttlMs: 1_000, maxEntries: 10, now: () => clock });
    const { loads, load } = counter();
    await cache.read("c|a", "f", load("first"));
    clock = 999;
    await cache.read("c|a", "f", load("second"));
    clock = 1_000;
    expect(await cache.read("c|a", "f", load("third"))).toBe("third");
    expect(loads).toEqual(["first", "third"]);
  });

  test("a failed read is not kept", async () => {
    const cache = createCohortCache({ ttlMs: 1_000, maxEntries: 10, now: () => 0 });
    const failing = async (): Promise<string> => {
      throw new Error("down");
    };
    await expect(cache.read("c|a", "f", failing)).rejects.toThrow("down");
    const { loads, load } = counter();
    expect(await cache.read("c|a", "f", load("again"))).toBe("again");
    expect(loads).toEqual(["again"]);
  });

  test("the oldest entry goes when it is full", async () => {
    const cache = createCohortCache({ ttlMs: 1_000, maxEntries: 2, now: () => 0 });
    const { loads, load } = counter();
    await cache.read("a", "f", load("a1"));
    await cache.read("b", "f", load("b1"));
    await cache.read("c", "f", load("c1"));
    await cache.read("b", "f", load("b2"));
    await cache.read("a", "f", load("a2"));
    expect(loads).toEqual(["a1", "b1", "c1", "a2"]);
  });
});
