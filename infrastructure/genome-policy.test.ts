import { describe, expect, test } from "bun:test";

import {
  type GenomeRequest,
  permitGenomeRequest,
  permitGenomeRun,
} from "./data-mode-policy";

const ALLOWED: GenomeRequest = {
  mode: "personal",
  genomeSource: "ark",
  chatProvider: "ollama",
  chatOnLoopback: true,
  carbonXOnLoopback: true,
};

const refusal = (reason: string) => ({ ok: false, code: "GENOME_NOT_PERMITTED", reason });

describe("permitGenomeRequest", () => {
  test("personal mode, Ark, local Ollama and local Carbon-X: allowed", () => {
    expect(permitGenomeRequest(ALLOWED)).toEqual({ ok: true });
  });

  test("synthetic mode never touches a genome", () => {
    expect(permitGenomeRequest({ ...ALLOWED, mode: "synthetic" })).toEqual(
      refusal("data-mode-not-personal"),
    );
  });

  test("GENOME_SOURCE=none refuses", () => {
    expect(permitGenomeRequest({ ...ALLOWED, genomeSource: "none" })).toEqual(
      refusal("genome-source-not-ark"),
    );
  });

  test("every hosted chat provider refuses, the consented Exoscale pilot included", () => {
    for (const chatProvider of [
      "exoscale",
      "openrouter",
      "remote-gpu",
      "infomaniak",
    ] as const) {
      expect(permitGenomeRequest({ ...ALLOWED, chatProvider })).toEqual(
        refusal("chat-model-not-local"),
      );
    }
  });

  test("Ollama on another machine refuses", () => {
    expect(permitGenomeRequest({ ...ALLOWED, chatOnLoopback: false })).toEqual(
      refusal("chat-model-not-local"),
    );
  });

  test("a Carbon-X off loopback refuses", () => {
    expect(permitGenomeRequest({ ...ALLOWED, carbonXOnLoopback: false })).toEqual(
      refusal("carbon-x-not-local"),
    );
  });
});

describe("permitGenomeRun", () => {
  test("running the Ark app needs personal mode and GENOME_SOURCE=ark only", () => {
    expect(permitGenomeRun({ mode: "personal", genomeSource: "ark" })).toEqual({
      ok: true,
    });
    expect(permitGenomeRun({ mode: "synthetic", genomeSource: "ark" })).toEqual(
      refusal("data-mode-not-personal"),
    );
    expect(permitGenomeRun({ mode: "personal", genomeSource: "none" })).toEqual(
      refusal("genome-source-not-ark"),
    );
  });
});
