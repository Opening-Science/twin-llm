import { describe, expect, test } from "bun:test";

import {
  DOCUMENT_EMBED_PREFIX,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  QUERY_EMBED_PREFIX,
} from "./constants";
import {
  assertLocalEmbedOrigin,
  defaultEmbedPorts,
  embedText,
  ollamaNativeOrigin,
} from "./embed";

const vector = Array.from({ length: EMBEDDING_DIM }, (_, index) => index / EMBEDDING_DIM);

describe("guideline embeddings", () => {
  test("strips /v1 and never uses a cloud embed host", () => {
    expect(ollamaNativeOrigin("http://127.0.0.1:11434/v1")).toBe(
      "http://127.0.0.1:11434",
    );
    expect(() => assertLocalEmbedOrigin("http://127.0.0.1:11434")).not.toThrow();
    expect(() => assertLocalEmbedOrigin("https://api.openai.com/v1")).toThrow(
      "GUIDELINE_EMBED_ORIGIN_BLOCKED",
    );
    expect(() => assertLocalEmbedOrigin("https://openrouter.ai/api/v1")).toThrow(
      "GUIDELINE_EMBED_ORIGIN_BLOCKED",
    );
    expect(() => assertLocalEmbedOrigin("https://api.infomaniak.com")).toThrow(
      "GUIDELINE_EMBED_ORIGIN_BLOCKED",
    );
  });

  test("document and query prefixes hit local /api/embed", async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const result = await embedText("NIV section", "document", {
      origin: "http://127.0.0.1:11434",
      model: EMBEDDING_MODEL,
      dim: EMBEDDING_DIM,
      fetch: (async (input, init) => {
        urls.push(String(input));
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ embeddings: [vector] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    expect(result).toHaveLength(EMBEDDING_DIM);
    expect(urls).toEqual(["http://127.0.0.1:11434/api/embed"]);
    expect(urls[0]).not.toContain("api.openai.com");
    expect(urls[0]).not.toContain("openrouter");
    expect(bodies[0]).toEqual({
      model: EMBEDDING_MODEL,
      input: `${DOCUMENT_EMBED_PREFIX}NIV section`,
    });
  });

  test("falls back to /api/embeddings with the query prefix", async () => {
    const urls: string[] = [];
    const result = await embedText("ALS NIV", "query", {
      origin: "http://127.0.0.1:11434",
      model: EMBEDDING_MODEL,
      dim: EMBEDDING_DIM,
      fetch: (async (input) => {
        urls.push(String(input));
        if (String(input).endsWith("/api/embed")) {
          return new Response("no", { status: 404 });
        }
        return new Response(
          JSON.stringify({
            embedding: vector,
            prompt: `${QUERY_EMBED_PREFIX}ALS NIV`,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });
    expect(result).toHaveLength(EMBEDDING_DIM);
    expect(urls).toEqual([
      "http://127.0.0.1:11434/api/embed",
      "http://127.0.0.1:11434/api/embeddings",
    ]);
  });

  test("request host is the configured origin, never a cloud endpoint", async () => {
    const origin = "http://127.0.0.1:21434";
    const urls: string[] = [];
    await embedText("query prefixes", "query", {
      origin,
      model: EMBEDDING_MODEL,
      dim: EMBEDDING_DIM,
      fetch: (async (input, init) => {
        urls.push(String(input));
        const body = JSON.parse(String(init?.body)) as { input?: string };
        expect(body.input).toBe(`${QUERY_EMBED_PREFIX}query prefixes`);
        return new Response(JSON.stringify({ embeddings: [vector] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    expect(urls).toEqual([`${origin}/api/embed`]);
    expect(new URL(urls[0] ?? "").origin).toBe(origin);
    expect(urls[0]).not.toContain("api.openai.com");
    expect(urls[0]).not.toContain("openrouter");
    expect(urls[0]).not.toContain("infomaniak");
  });

  test("Ollama down returns empty and does not call a cloud host", async () => {
    const urls: string[] = [];
    const result = await embedText("NIV", "document", {
      origin: "http://127.0.0.1:11434",
      model: EMBEDDING_MODEL,
      dim: EMBEDDING_DIM,
      fetch: (async (input) => {
        urls.push(String(input));
        throw new Error("connect ECONNREFUSED");
      }) as typeof fetch,
    });
    expect(result).toBeNull();
    expect(urls.every((url) => url.startsWith("http://127.0.0.1:11434/"))).toBe(true);
  });

  test("dim mismatch returns null", async () => {
    const result = await embedText("x", "query", {
      origin: "http://127.0.0.1:11434",
      model: EMBEDDING_MODEL,
      dim: EMBEDDING_DIM,
      fetch: (async () =>
        new Response(JSON.stringify({ embedding: [1, 2, 3] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    expect(result).toBeNull();
  });
});

describe("defaultEmbedPorts from injected env", () => {
  test("strips /v1 from a local OLLAMA_BASE_URL", () => {
    expect(
      defaultEmbedPorts({ OLLAMA_BASE_URL: "http://127.0.0.1:21434/v1" }).origin,
    ).toBe("http://127.0.0.1:21434");
  });

  test("rejects a cloud OLLAMA_BASE_URL", () => {
    expect(() =>
      assertLocalEmbedOrigin(
        defaultEmbedPorts({ OLLAMA_BASE_URL: "https://api.openai.com/v1" }).origin,
      ),
    ).toThrow("GUIDELINE_EMBED_ORIGIN_BLOCKED");
  });
});

describe("LOCAL_ONLY embed origin", () => {
  test("a LAN origin passes the blocklist but fails when loopback is required", () => {
    expect(() => assertLocalEmbedOrigin("http://192.168.1.20:11434")).not.toThrow();
    expect(() =>
      assertLocalEmbedOrigin("http://192.168.1.20:11434", { requireLoopback: true }),
    ).toThrow("GUIDELINE_EMBED_ORIGIN_NOT_LOCAL");
  });

  test("loopback origins pass when loopback is required", () => {
    expect(() =>
      assertLocalEmbedOrigin("http://127.0.0.1:11434", { requireLoopback: true }),
    ).not.toThrow();
    expect(() =>
      assertLocalEmbedOrigin("http://[::1]:11434", { requireLoopback: true }),
    ).not.toThrow();
  });

  test("defaultEmbedPorts carries LOCAL_ONLY into requireLoopback", () => {
    expect(defaultEmbedPorts({ LOCAL_ONLY: true }).requireLoopback).toBe(true);
    expect(defaultEmbedPorts({}).requireLoopback).toBe(false);
  });

  test("embedText refuses a LAN origin before any request in LOCAL_ONLY mode", async () => {
    let calls = 0;
    const attempt = embedText("NIV section", "query", {
      origin: "http://192.168.1.20:11434",
      model: EMBEDDING_MODEL,
      dim: EMBEDDING_DIM,
      requireLoopback: true,
      fetch: (async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    await expect(attempt).rejects.toThrow("GUIDELINE_EMBED_ORIGIN_NOT_LOCAL");
    expect(calls).toBe(0);
  });
});
