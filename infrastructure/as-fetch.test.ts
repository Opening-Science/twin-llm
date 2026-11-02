import { describe, expect, test } from "bun:test";

import { asFetch } from "./as-fetch";

// A stand-in for a runtime fetch with an extra member, as Bun's has.
const baseFetch = (body: string) =>
  Object.assign(async () => new Response(body), { preconnect: (): void => undefined });

describe("asFetch", () => {
  test("sends requests through the wrapper, not the base fetch", async () => {
    const seen: string[] = [];
    const wrapped = asFetch(async (input) => {
      seen.push(String(input));
      return new Response("wrapped");
    }, baseFetch("base"));
    const response = await wrapped("https://example.invalid/a");
    expect(await response.text()).toBe("wrapped");
    expect(seen).toEqual(["https://example.invalid/a"]);
  });

  test("carries the base fetch's own members and leaves the wrapper untouched", () => {
    const call = async () => new Response("");
    const wrapped = asFetch(call, baseFetch(""));
    expect(Object.keys(wrapped)).toEqual(["preconnect"]);
    expect(Object.keys(call)).toEqual([]);
  });
});
