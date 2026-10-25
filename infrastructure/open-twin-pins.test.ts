import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LOINC_CODINGS } from "@open-twin/fhir-core";
import { normaliseBundle } from "@open-twin/fhir-r4";
import {
  SYSTEM_IDS,
  validateInterpretationDocument,
} from "@open-twin/interpretation-contract";
import {
  GoogleHealthClient,
  getFhirBundleFromGoogleHealthData,
  getGoogleHealthAuthUrl,
  initializeGoogleHealthClient,
} from "@open-twin/provider-google-health";
import {
  getFhirBundleFromOuraData,
  getOuraData,
  TokenHandler,
} from "@open-twin/provider-oura";
import {
  createWhoopOAuthState,
  exchangeWhoopCode,
  getWhoopAuthorizationUrl,
  getWhoopData,
  refreshWhoopToken,
  TokenHandler as WhoopTokenHandler,
  WHOOP_SCOPES,
} from "@open-twin/provider-whoop";
import {
  buildBundleFromVitronicResponse,
  createBodyLoopClient,
} from "@open-twin/provider-vitronic";

import { getAuthorizationUrl } from "@/infrastructure/open-twin-adapters/oura-authorize";

/** The JSON is the package's only data export; its sha256 sidecar sits next to it. */
const ANCHOR_JSON = fileURLToPath(
  import.meta.resolve("@open-twin/anchor-layer/data/anchor-layer.v1.json"),
);

describe("open-twin pin smoke", () => {
  test("fhir-r4 exports normaliseBundle", () => {
    expect(typeof normaliseBundle).toBe("function");
  });

  test("interpretation-contract exports validateInterpretationDocument and nine SystemIds", () => {
    expect(typeof validateInterpretationDocument).toBe("function");
    expect(SYSTEM_IDS).toEqual([
      "musculoskeletal",
      "cardiovascular",
      "nervous",
      "respiratory",
      "metabolic",
      "digestive",
      "endocrine",
      "integumentary",
      "reproductive",
    ]);
  });

  test("fhir-core LOINC_CODINGS includes heart-rate, SpO2, time-in-bed codes", () => {
    const blob = JSON.stringify(LOINC_CODINGS);
    for (const code of ["8867-4", "59408-5", "103213-5"] as const) {
      expect(blob.includes(code)).toBe(true);
    }
  });

  test("provider-oura exports host inventory symbols", () => {
    expect(typeof getFhirBundleFromOuraData).toBe("function");
    expect(typeof getOuraData).toBe("function");
    expect(typeof TokenHandler).toBe("function");
    expect(typeof getAuthorizationUrl).toBe("function");
  });

  test("provider-google-health exports host inventory symbols", () => {
    expect(typeof GoogleHealthClient).toBe("function");
    expect(typeof getFhirBundleFromGoogleHealthData).toBe("function");
    expect(typeof getGoogleHealthAuthUrl).toBe("function");
    expect(typeof initializeGoogleHealthClient).toBe("function");
  });

  test("provider-whoop exports host inventory symbols", () => {
    expect(typeof createWhoopOAuthState).toBe("function");
    expect(typeof exchangeWhoopCode).toBe("function");
    expect(typeof getWhoopData).toBe("function");
    expect(typeof getWhoopAuthorizationUrl).toBe("function");
    expect(typeof refreshWhoopToken).toBe("function");
    expect(typeof WhoopTokenHandler).toBe("function");
    expect(Array.isArray(WHOOP_SCOPES)).toBe(true);
  });

  test("anchor-layer data matches its sha256 sidecar and holds 67 biomarkers", () => {
    const bytes = readFileSync(ANCHOR_JSON);
    const sidecar = readFileSync(`${ANCHOR_JSON}.sha256`, "utf8").trim().split(/\s+/)[0];
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sidecar!);
    expect(sidecar).toBe(
      "7adc42afaa03ee568a9f8eea5b451a8b51c9851e116f90951009d1b31894682e",
    );
    const layer = JSON.parse(bytes.toString("utf8")) as {
      schema_version: string;
      biomarkers: readonly unknown[];
    };
    expect(layer.schema_version).toBe("anchor-layer.v1");
    expect(layer.biomarkers).toHaveLength(67);
  });

  test("provider-vitronic exports mapping and the password client (host must not call the latter)", () => {
    expect(typeof buildBundleFromVitronicResponse).toBe("function");
    expect(typeof createBodyLoopClient).toBe("function");
  });
});
