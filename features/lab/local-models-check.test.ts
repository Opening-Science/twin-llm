import { describe, expect, test } from "bun:test";

import { unavailableCheck } from "./lab-check";
import {
  localModelsBase,
  localModelsCheck,
  localModelsHowTo,
  ollamaTagsUrl,
  parseOllamaModels,
} from "./local-models-check";

const LOCAL = ollamaTagsUrl("http://127.0.0.1:11434/v1");

const TAGS = {
  models: [
    {
      name: "qwen3:8b",
      digest: "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41",
      size: 5_225_387_652,
      details: { family: "qwen3", parameter_size: "8.2B", quantization_level: "Q4_K_M" },
    },
    { name: "nomic-embed-text:latest", digest: "0a109f422b47", size: 274_302_450 },
  ],
};

describe("parseOllamaModels", () => {
  test("reads name, digest, size and family, sorted by name", () => {
    expect(parseOllamaModels(TAGS)).toEqual([
      {
        name: "nomic-embed-text:latest",
        digest: "0a109f422b47",
        sizeBytes: 274_302_450,
        family: null,
        parameters: null,
        quantization: null,
      },
      {
        name: "qwen3:8b",
        digest: "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41",
        sizeBytes: 5_225_387_652,
        family: "qwen3",
        parameters: "8.2B",
        quantization: "Q4_K_M",
      },
    ]);
  });

  test("anything else is null", () => {
    expect(parseOllamaModels({ error: "boom" })).toBe(null);
    expect(parseOllamaModels(null)).toBe(null);
  });
});

describe("localModelsCheck", () => {
  test("Ollama down is unknown with a plain message", () => {
    const check = localModelsCheck({ onLoopback: true, tagsUrl: LOCAL, models: null });
    expect(check.status).toBe("unknown");
    expect(check.summary).toBe(
      "Ollama did not answer just now, so its models could not be listed. Start it with `ollama serve` and reload this page.",
    );
    expect(check.table).toBe(undefined);
  });

  test("models on this machine are ok, with a row each", () => {
    const check = localModelsCheck({
      onLoopback: true,
      tagsUrl: LOCAL,
      models: parseOllamaModels(TAGS),
    });
    expect(check.status).toBe("ok");
    expect(check.table?.rows).toEqual([
      ["nomic-embed-text:latest", "0a109f422b47", "274.3 MB", "—"],
      ["qwen3:8b", "500a1f067a9f", "5.2 GB", "qwen3 · 8.2B · Q4_K_M"],
    ]);
  });

  test("no models is unknown", () => {
    expect(
      localModelsCheck({ onLoopback: true, tagsUrl: LOCAL, models: [] }).status,
    ).toBe("unknown");
  });

  test("Ollama on another machine is not ok", () => {
    const check = localModelsCheck({
      onLoopback: false,
      tagsUrl: ollamaTagsUrl("http://gpu-box:11434/v1"),
      models: parseOllamaModels(TAGS),
    });
    expect(check.status).toBe("not-ok");
    expect(check.table?.rows.length).toBe(2);
  });

  test("Ollama on another machine that does not answer is not ok, not a local how-to", () => {
    const check = localModelsCheck({
      onLoopback: false,
      tagsUrl: ollamaTagsUrl("http://gpu-box:11434/v1"),
      models: null,
    });
    expect(check.status).toBe("not-ok");
    expect(check.summary).not.toContain("ollama serve");
    expect(check.howTo).toContain("curl -s http://gpu-box:11434/api/tags");
  });
});

describe("ollamaTagsUrl and the command", () => {
  test("follows the configured host and port, without credentials or query", () => {
    expect(ollamaTagsUrl("http://127.0.0.1:11434/v1")).toBe(
      "http://127.0.0.1:11434/api/tags",
    );
    expect(ollamaTagsUrl("http://user:pw@localhost:11500/v1/?token=x")).toBe(
      "http://localhost:11500/api/tags",
    );
    expect(ollamaTagsUrl("not a url")).toBe(null);
  });

  test("the default address uses plain ollama list", () => {
    expect(localModelsHowTo(LOCAL)).toBe(
      [
        "ollama list",
        `curl -s http://127.0.0.1:11434/api/tags | jq -r '.models[] | "\\(.digest)  \\(.name)"'`,
      ].join("\n"),
    );
  });

  test("another port is named for ollama list too", () => {
    expect(localModelsHowTo(ollamaTagsUrl("http://localhost:11500/v1"))).toStartWith(
      "OLLAMA_HOST=http://localhost:11500 ollama list\ncurl -s http://localhost:11500/api/tags",
    );
  });

  test("the card that could not run shows the same command", () => {
    const url = ollamaTagsUrl("http://localhost:11500/v1");
    expect(unavailableCheck(localModelsBase(url)).howTo).toBe(
      localModelsCheck({ onLoopback: true, tagsUrl: url, models: [] }).howTo,
    );
  });
});
