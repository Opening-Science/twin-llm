import { describe, expect, test } from "bun:test";

import { createLiveFetch } from "./fetch";

const spacing = () => {
  const calls: string[] = [];
  return {
    calls,
    spacing: {
      pubmed: async () => {
        calls.push("pubmed");
      },
      ensembl: async () => {
        calls.push("ensembl");
      },
    },
  };
};

const request = {
  source: "ensembl",
  step: "gene",
  url: "https://rest.ensembl.org/lookup/symbol/homo_sapiens/APOE?content-type=application/json",
  carries: "search terms",
} as const;

describe("createLiveFetch", () => {
  test("a GET that follows no redirect, after its service's turn", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const { calls, spacing: queues } = spacing();
    const live = createLiveFetch({
      fetchFn: (async (url: string, init?: RequestInit) => {
        seen.push({ url, init });
        return new Response('{"id":"x"}', { status: 200 });
      }) as unknown as typeof fetch,
      spacing: queues,
    });
    expect(await live(request)).toEqual({ status: 200, body: '{"id":"x"}' });
    expect(calls).toEqual(["ensembl"]);
    expect(seen.map(({ url, init }) => [url, init?.method, init?.redirect])).toEqual([
      [request.url, "GET", "error"],
    ]);
  });

  test("an address off the allowlist is never fetched", async () => {
    const { calls, spacing: queues } = spacing();
    const fetched: string[] = [];
    const live = createLiveFetch({
      fetchFn: (async (url: string) => {
        fetched.push(url);
        return new Response("");
      }) as unknown as typeof fetch,
      spacing: queues,
    });
    await expect(live({ ...request, url: "https://example.org/" })).rejects.toThrow(
      "LIVE_ORIGIN_NOT_ALLOWED",
    );
    expect([calls, fetched]).toEqual([[], []]);
  });

  test("a body past the cap fails", async () => {
    const live = createLiveFetch({
      fetchFn: (async () => new Response("x".repeat(20))) as unknown as typeof fetch,
      spacing: spacing().spacing,
      maxBytes: 10,
    });
    await expect(live(request)).rejects.toThrow("LIVE_RESPONSE_TOO_LARGE");
  });
});
