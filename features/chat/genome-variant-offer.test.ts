import { describe, expect, test } from "bun:test";

import {
  GENOME_NOT_PERMITTED,
  type GenomePermitDecision,
} from "@/infrastructure/data-mode-policy";

import { offerGenomeVariants } from "./genome-variant-offer";

const LOCAL: GenomePermitDecision = { ok: true };
const HOSTED: GenomePermitDecision = {
  ok: false,
  code: GENOME_NOT_PERMITTED,
  reason: "chat-model-not-local",
};

/** Runs the offer and counts how often the VCF store was asked. */
const offer = async (
  mode: "personal" | "synthetic",
  permit: GenomePermitDecision,
  vcfImported: boolean,
) => {
  const asked = { count: 0 };
  const offered = await offerGenomeVariants({
    mode,
    permit: () => permit,
    hasImportedVcf: async () => {
      asked.count += 1;
      return vcfImported;
    },
  });
  return { offered, asked: asked.count };
};

describe("offerGenomeVariants (#399)", () => {
  test("a local model and an imported VCF: offered", async () => {
    expect(await offer("personal", LOCAL, true)).toEqual({ offered: true, asked: 1 });
  });

  test("a local model and no VCF: not offered", async () => {
    expect(await offer("personal", LOCAL, false)).toEqual({ offered: false, asked: 1 });
  });

  test("a hosted model with an imported VCF: not offered, and the store is not asked", async () => {
    expect(await offer("personal", HOSTED, true)).toEqual({ offered: false, asked: 0 });
  });

  test("a hosted model and no VCF: not offered, and the store is not asked", async () => {
    expect(await offer("personal", HOSTED, false)).toEqual({ offered: false, asked: 0 });
  });

  test("synthetic mode: not offered, and neither the permit nor the store is asked", async () => {
    const permitted = { count: 0 };
    const asked = { count: 0 };
    const offered = await offerGenomeVariants({
      mode: "synthetic",
      permit: () => {
        permitted.count += 1;
        return LOCAL;
      },
      hasImportedVcf: async () => {
        asked.count += 1;
        return true;
      },
    });
    expect({ offered, permitted: permitted.count, asked: asked.count }).toEqual({
      offered: false,
      permitted: 0,
      asked: 0,
    });
  });
});
