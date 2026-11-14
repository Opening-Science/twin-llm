import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { LOINC_CODINGS } from "@open-twin/fhir-core";
import { normaliseBundle } from "@open-twin/fhir-r4";
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

import { getAuthorizationUrl } from "@/infrastructure/open-twin-adapters/oura";

/** The JSON is the package's only data export; its sha256 sidecar sits next to it. */
const ANCHOR_JSON = fileURLToPath(
  import.meta.resolve("@open-twin/anchor-layer/data/anchor-layer.v1.json"),
);

const OPEN_TWIN = join(import.meta.dir, "../packages/open-twin");
/** Adapted to this repository, or this repository's own records: not in the manifest. */
const NOT_AS_WRITTEN = new Set(["package.json", "UPSTREAM.json", "MANIFEST.sha256"]);

const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && !NOT_AS_WRITTEN.has(entry.name))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .filter((path) => !path.split("/").includes("node_modules"))
    .sort();

/** MANIFEST.sha256 as path → sha256, in `sha256sum` format. */
const manifest = (): ReadonlyMap<string, string> =>
  new Map(
    readFileSync(join(OPEN_TWIN, "MANIFEST.sha256"), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const [hash = "", path = ""] = line.split(/\s+/);
        return [path, hash] as const;
      }),
  );

describe("packages/open-twin is the copy MANIFEST.sha256 records", () => {
  test("every file is listed, and none changed without the manifest", () => {
    const listed = manifest();
    const files = filesUnder(OPEN_TWIN);
    expect(files).toEqual([...listed.keys()].sort());
    const changed = files.filter(
      (path) => sha256(join(OPEN_TWIN, path)) !== listed.get(path),
    );
    expect(changed).toEqual([]);
  });

  test("UPSTREAM.json names a base commit for each package", () => {
    const upstream = JSON.parse(
      readFileSync(join(OPEN_TWIN, "UPSTREAM.json"), "utf8"),
    ) as {
      repo: string;
      packages: Readonly<Record<string, { base: string; imported: string }>>;
    };
    const dirs = readdirSync(OPEN_TWIN, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(Object.keys(upstream.packages).sort()).toEqual(dirs);
    for (const { base, imported } of Object.values(upstream.packages)) {
      expect(base).toMatch(/^[0-9a-f]{40}$/);
      expect(imported).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("the workspace name resolves to the copied source, one module instance", () => {
    const viaWorkspace = realpathSync(
      fileURLToPath(import.meta.resolve("@open-twin/provider-oura")),
    );
    expect(viaWorkspace).toBe(
      realpathSync(join(OPEN_TWIN, "provider-oura/src/index.ts")),
    );
  });
});

describe("open-twin package exports", () => {
  test("fhir-r4 exports normaliseBundle", () => {
    expect(typeof normaliseBundle).toBe("function");
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
});
