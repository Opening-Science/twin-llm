import { describe, expect, test } from "bun:test";

import { genomeEnv, parseServerEnv } from "./env";

const BASE = {
  LOCAL_ONLY: "true",
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  DATA_MODE: "personal",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
} as const;

const parseError = (source: NodeJS.ProcessEnv): string => {
  try {
    parseServerEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parseServerEnv to throw");
};

describe("genome env", () => {
  test("defaults: no genome, Carbon-X on loopback 8090, two-minute timeout", () => {
    expect(genomeEnv(parseServerEnv(BASE))).toEqual({
      source: "none",
      rsidGenotypesWasm: null,
      referenceDir: null,
      assumeBuild: null,
      carbonXUrl: "http://127.0.0.1:8090/v1",
      carbonXTimeoutMs: 120_000,
    });
  });

  test("reads the Ark, reference and Carbon-X settings", () => {
    const env = parseServerEnv({
      ...BASE,
      GENOME_SOURCE: "ark",
      ARK_RSID_GENOTYPES_WASM: "/opt/ark/rsid-genotypes.wasm",
      GENOME_REFERENCE_DIR: "/data/grch38",
      GENOME_ASSUME_BUILD: "GRCh38",
      CARBON_X_URL: "http://localhost:9000/v1",
      CARBON_X_TIMEOUT_S: "30",
    });
    expect(genomeEnv(env)).toEqual({
      source: "ark",
      rsidGenotypesWasm: "/opt/ark/rsid-genotypes.wasm",
      referenceDir: "/data/grch38",
      assumeBuild: "GRCh38",
      carbonXUrl: "http://localhost:9000/v1",
      carbonXTimeoutMs: 30_000,
    });
  });

  test("a Carbon-X URL off this machine stops the boot", () => {
    expect(
      parseError({ ...BASE, CARBON_X_URL: "https://carbon.example.org/v1" }),
    ).toContain("CARBON_X_URL: CARBON_X_URL must be on this machine");
  });

  test("GENOME_ASSUME_BUILD accepts GRCh38 only", () => {
    expect(parseError({ ...BASE, GENOME_ASSUME_BUILD: "GRCh37" })).toContain(
      "GENOME_ASSUME_BUILD may only be GRCh38",
    );
  });
});
