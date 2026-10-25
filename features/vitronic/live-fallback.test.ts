import { describe, expect, test } from "bun:test";

import { liveOrFallback } from "./live-fallback";

describe("liveOrFallback", () => {
  test("returns the live value when the attempt succeeds in time", async () => {
    const result = await liveOrFallback(async () => [1, 2], [] as number[], 200);
    expect(result).toEqual({ value: [1, 2], live: true });
  });

  test("falls back when the attempt never settles", async () => {
    const started = Date.now();
    const result = await liveOrFallback(
      () => new Promise<number[]>(() => undefined),
      [] as number[],
      50,
    );
    expect(result).toEqual({ value: [], live: false });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("falls back, without throwing, when the attempt rejects", async () => {
    const result = await liveOrFallback(
      async () => {
        throw new Error("ECONNREFUSED 192.168.0.1");
      },
      [] as number[],
      200,
    );
    expect(result).toEqual({ value: [], live: false });
  });
});
