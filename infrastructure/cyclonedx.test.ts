import { describe, expect, test } from "bun:test";

import {
  bomText,
  buildBom,
  integrityToHex,
  npmPurl,
  parseBunLock,
  splitSpec,
} from "./cyclonedx";

const LOCK = `{
  "lockfileVersion": 1,
  "workspaces": { "": { "name": "app", }, },
  "packages": {
    "zod": ["zod@4.6.6", "", {}, "sha512-AAEC"],
    "@ai-sdk/openai": ["@ai-sdk/openai@4.0.60", "", { "dependencies": {} }, "sha512-/w=="],
    "other/zod": ["zod@4.6.6", "", {}, "sha512-AAEC"],
    "@open-twin/fhir-core": ["@open-twin/fhir-core@file:.open-twin/packages/fhir-core", {}],
    "odd": [42],
  },
}`;

describe("parseBunLock", () => {
  test("reads JSON with trailing commas", () => {
    expect(parseBunLock(`{ "a": [1, 2,], }`)).toEqual({ a: [1, 2] });
  });
});

describe("splitSpec", () => {
  test("splits a scoped name at the version's @", () => {
    expect(splitSpec("@ai-sdk/openai@4.0.60")).toEqual({
      name: "@ai-sdk/openai",
      version: "4.0.60",
    });
  });
  test("splits a plain name", () => {
    expect(splitSpec("zod@4.6.6")).toEqual({ name: "zod", version: "4.6.6" });
  });
  test("refuses a spec without a version", () => {
    expect(splitSpec("zod")).toBe(null);
    expect(splitSpec("zod@")).toBe(null);
  });
});

describe("integrityToHex", () => {
  test("turns base64 sha512 into hex", () => {
    expect(integrityToHex("sha512-AAEC")).toBe("000102");
  });
  test("ignores other algorithms", () => {
    expect(integrityToHex("sha1-AAEC")).toBe(null);
  });
});

describe("npmPurl", () => {
  test("encodes the scope", () => {
    expect(npmPurl("@ai-sdk/openai", "4.0.60")).toBe("pkg:npm/%40ai-sdk/openai@4.0.60");
    expect(npmPurl("zod", "4.6.6")).toBe("pkg:npm/zod@4.6.6");
  });
});

describe("buildBom", () => {
  test("lists each package once, sorted, with hashes and local sources", () => {
    const bom = buildBom(parseBunLock(LOCK), { name: "app", version: "0.1.0" });
    expect(bom.metadata.component).toEqual({
      type: "application",
      "bom-ref": "app@0.1.0",
      name: "app",
      version: "0.1.0",
    });
    expect(bom.components).toEqual([
      {
        type: "library",
        "bom-ref": "pkg:npm/%40ai-sdk/openai@4.0.60",
        name: "@ai-sdk/openai",
        version: "4.0.60",
        purl: "pkg:npm/%40ai-sdk/openai@4.0.60",
        hashes: [{ alg: "SHA-512", content: "ff" }],
      },
      {
        type: "library",
        "bom-ref": "@open-twin/fhir-core@file:.open-twin/packages/fhir-core",
        name: "@open-twin/fhir-core",
        version: "file:.open-twin/packages/fhir-core",
        properties: [{ name: "bun:source", value: "file:.open-twin/packages/fhir-core" }],
      },
      {
        type: "library",
        "bom-ref": "pkg:npm/zod@4.6.6",
        name: "zod",
        version: "4.6.6",
        purl: "pkg:npm/zod@4.6.6",
        hashes: [{ alg: "SHA-512", content: "000102" }],
      },
    ]);
  });

  test("gives the same bytes for the same lockfile", () => {
    const app = { name: "app", version: "0.1.0" };
    const text = bomText(buildBom(parseBunLock(LOCK), app));
    expect(text).toBe(bomText(buildBom(parseBunLock(LOCK), app)));
    expect(
      text.startsWith('{\n  "bomFormat": "CycloneDX",\n  "specVersion": "1.6",'),
    ).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
  });

  test("refuses a lockfile without packages", () => {
    expect(() => buildBom({}, { name: "app", version: "0.1.0" })).toThrow(
      "bun.lock has no packages table",
    );
  });
});
