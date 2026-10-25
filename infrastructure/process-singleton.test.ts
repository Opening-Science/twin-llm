import { describe, expect, test } from "bun:test";

import { processSingleton, type SingletonHolder } from "./process-singleton";

describe("processSingleton", () => {
  test("builds once and returns the same instance on every later call", () => {
    const holder: SingletonHolder = {};
    let builds = 0;
    const get = processSingleton(
      "client",
      () => {
        builds += 1;
        return { id: builds };
      },
      holder,
    );

    const first = get();
    expect(get()).toBe(first);
    expect(get()).toBe(first);
    expect(builds).toBe(1);
  });

  test("caches under NODE_ENV=production too", () => {
    const previous = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      const holder: SingletonHolder = {};
      let builds = 0;
      const get = processSingleton("prod", () => ({ n: (builds += 1) }), holder);
      const results = Array.from({ length: 50 }, () => get());
      expect(new Set(results).size).toBe(1);
      expect(builds).toBe(1);
    } finally {
      Object.assign(process.env, { NODE_ENV: previous });
    }
  });

  test("a second accessor on the same holder and key shares the instance", () => {
    const holder: SingletonHolder = {};
    const a = processSingleton("shared", () => ({}), holder);
    const b = processSingleton("shared", () => ({}), holder);
    expect(a()).toBe(b());
  });
});
