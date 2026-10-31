import { describe, expect, test } from "bun:test";

import {
  type GenomeRequest,
  permitGenomeRequest,
  permitGenomeRun,
  permitVcfVariantsRequest,
  type VcfVariantsRequest,
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

describe("permitVcfVariantsRequest (#330)", () => {
  const VCF_ONLY: VcfVariantsRequest = {
    mode: "personal",
    chatProvider: "ollama",
    chatOnLoopback: true,
  };

  test("an imported VCF and Ollama on loopback are enough: no Ark, no Carbon-X", () => {
    expect(permitVcfVariantsRequest(VCF_ONLY)).toEqual({ ok: true });
    // The same setup without Ark or Carbon-X is refused for the report tools.
    expect(
      permitGenomeRequest({
        ...VCF_ONLY,
        genomeSource: "none",
        carbonXOnLoopback: false,
      }),
    ).toEqual(refusal("genome-source-not-ark"));
  });

  test("every hosted chat provider refuses, the consented Exoscale pilot included", () => {
    for (const chatProvider of [
      "exoscale",
      "openrouter",
      "remote-gpu",
      "infomaniak",
    ] as const) {
      expect(permitVcfVariantsRequest({ ...VCF_ONLY, chatProvider })).toEqual(
        refusal("chat-model-not-local"),
      );
      expect(
        permitVcfVariantsRequest({ ...VCF_ONLY, chatProvider, chatOnLoopback: false }),
      ).toEqual(refusal("chat-model-not-local"));
    }
  });

  test("Ollama on another machine refuses", () => {
    expect(permitVcfVariantsRequest({ ...VCF_ONLY, chatOnLoopback: false })).toEqual(
      refusal("chat-model-not-local"),
    );
  });

  test("synthetic mode refuses first, whatever the model", () => {
    expect(permitVcfVariantsRequest({ ...VCF_ONLY, mode: "synthetic" })).toEqual(
      refusal("data-mode-not-personal"),
    );
    expect(
      permitVcfVariantsRequest({
        mode: "synthetic",
        chatProvider: "openrouter",
        chatOnLoopback: false,
      }),
    ).toEqual(refusal("data-mode-not-personal"));
  });
});
