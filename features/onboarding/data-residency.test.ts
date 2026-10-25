import { describe, expect, test } from "bun:test";

import {
  interestHint,
  residencyChoice,
  type ResidencyConfig,
  residencyRows,
} from "./data-residency";

const localOnly: ResidencyConfig = {
  localOnly: true,
  provider: "ollama",
  dataMode: "synthetic",
  gbdConfigured: false,
  ollamaOnLoopback: true,
};

const where = (config: ResidencyConfig) =>
  Object.fromEntries(residencyRows(config).map((row) => [row.id, [row.tone, row.where]]));

describe("where your data goes", () => {
  test("local-only keeps the model and embeddings here and turns cloud services off", () => {
    expect(residencyChoice(localOnly)).toBe("local-only");
    expect(where(localOnly)).toEqual({
      chat: ["stays", "Stays on this machine: Ollama on loopback."],
      embeddings: ["stays", "Stay on this machine."],
      wearables: [
        "download",
        "Downloaded from each vendor's cloud over OAuth. Nothing from TwinLLM is uploaded to them.",
      ],
      gbd: ["off", "Off in local-only mode."],
      services: ["off", "Off in local-only mode."],
      bodyloop: ["stays", "Read from the scanner on the local network."],
      genome: ["stays", "Stays on the device; TwinLLM reads its status only."],
      secrets: ["stays", "Never leave this machine."],
    });
  });

  test("exoscale sends the chat payload to our own models and GBD when set up", () => {
    const config: ResidencyConfig = {
      ...localOnly,
      localOnly: false,
      provider: "exoscale",
      gbdConfigured: true,
    };
    expect(residencyChoice(config)).toBe("own-cloud");
    const rows = where(config);
    expect(rows.chat).toEqual([
      "leaves",
      "Sent to our own open models on Exoscale in Switzerland.",
    ]);
    expect(rows.gbd).toEqual(["leaves", "The query is sent to the remote GBD server."]);
    expect(rows.services).toEqual([
      "leaves",
      "Used only when their keys are set on this server.",
    ]);
    expect(rows.embeddings).toEqual(["stays", "Stay on this machine."]);
  });

  test("ollama elsewhere and OpenRouter read as leaving, never as local", () => {
    const remoteOllama: ResidencyConfig = {
      ...localOnly,
      localOnly: false,
      ollamaOnLoopback: false,
    };
    expect(residencyChoice(remoteOllama)).toBe("other");
    expect(where(remoteOllama).chat).toEqual([
      "leaves",
      "Sent to the Ollama server at the configured address.",
    ]);
    expect(where(remoteOllama).embeddings[0]).toBe("leaves");

    const openrouter: ResidencyConfig = { ...remoteOllama, provider: "openrouter" };
    expect(where(openrouter).chat).toEqual([
      "leaves",
      "Sent to OpenRouter, synthetic data only and never with a wearable snapshot.",
    ]);
    expect(where({ ...openrouter, gbdConfigured: false }).gbd).toEqual([
      "off",
      "Not set up on this server.",
    ]);
  });
});

describe("interest hint", () => {
  test("says where the typed text goes", () => {
    expect(interestHint(localOnly)).toBe(
      "Leave out names and other personal details. What you type stays on this machine.",
    );
    expect(interestHint({ ...localOnly, localOnly: false, provider: "exoscale" })).toBe(
      "Leave out names and other personal details. What you type goes to the model that writes the starters. Sent to our own open models on Exoscale in Switzerland.",
    );
  });
});
