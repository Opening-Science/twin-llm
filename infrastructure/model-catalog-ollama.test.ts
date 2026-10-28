import { describe, expect, test } from "bun:test";

import { parseOllamaTags } from "./model-catalog";

describe("parseOllamaTags", () => {
  test("keeps chat models with their tag and drops embedding-only models", () => {
    const models = parseOllamaTags({
      models: [
        {
          name: "nomic-embed-text:latest",
          capabilities: ["embedding"],
          details: { context_length: 2048 },
        },
        {
          name: "qwen3:8b",
          capabilities: ["completion", "tools", "thinking"],
          details: { context_length: 40960 },
        },
        { name: "llama3.2:latest", capabilities: ["completion", "tools"] },
      ],
    });
    expect(models).toEqual([
      {
        id: "qwen3:8b",
        name: "qwen3:8b",
        provider: "Ollama",
        providerId: "ollama",
        contextTokens: 40960,
      },
      {
        id: "llama3.2",
        name: "llama3.2",
        provider: "Ollama",
        providerId: "ollama",
        contextTokens: 128_000,
        contextUnknown: true,
      },
    ]);
  });

  test("lists the largest context window first, whatever order the daemon used", () => {
    const models = parseOllamaTags({
      models: [
        { name: "qwen3:8b", details: { context_length: 40960 } },
        { name: "qwen3:30b", details: { context_length: 262_144 } },
      ],
    });
    expect(models?.map((model) => [model.id, model.contextTokens])).toEqual([
      ["qwen3:30b", 262_144],
      ["qwen3:8b", 40960],
    ]);
  });

  test("rows without a reported window keep server order, after the real ones", () => {
    const models = parseOllamaTags({
      models: [
        { name: "zeta:1b" },
        { name: "qwen3:8b", details: { context_length: 40960 } },
        { name: "alpha:1b" },
        { name: "qwen3:30b", details: { context_length: 262_144 } },
      ],
    });
    expect(models?.map((model) => model.id)).toEqual([
      "qwen3:30b",
      "qwen3:8b",
      "zeta:1b",
      "alpha:1b",
    ]);
  });

  test("falls back to the name when an older daemon omits capabilities", () => {
    const models = parseOllamaTags({
      models: [{ name: "mxbai-embed-large:latest" }, { name: "mistral:7b" }],
    });
    expect(models?.map((model) => model.id)).toEqual(["mistral:7b"]);
  });

  test("returns an empty list when only embedding models are pulled", () => {
    expect(
      parseOllamaTags({
        models: [{ name: "nomic-embed-text", capabilities: ["embedding"] }],
      }),
    ).toEqual([]);
  });

  test("drops malformed rows and rejects a malformed body", () => {
    expect(
      parseOllamaTags({ models: [{ name: "" }, 42, { name: "gemma3:4b" }] }),
    ).toEqual([
      {
        id: "gemma3:4b",
        name: "gemma3:4b",
        provider: "Ollama",
        providerId: "ollama",
        contextTokens: 128_000,
        contextUnknown: true,
      },
    ]);
    expect(parseOllamaTags({ tags: [] })).toBeNull();
  });

  test("shows the window the chat runs with when it is smaller than the tag's", () => {
    const models = parseOllamaTags(
      {
        models: [
          { name: "qwen3:4b", details: { context_length: 262_144 } },
          { name: "tiny:latest", details: { context_length: 8192 } },
          { name: "bare:latest" },
        ],
      },
      16_384,
    );
    expect(
      models?.map((model) => [model.id, model.contextTokens, model.contextUnknown]),
    ).toEqual([
      ["bare", 16_384, undefined],
      ["qwen3:4b", 16_384, undefined],
      ["tiny", 8192, undefined],
    ]);
  });
});
