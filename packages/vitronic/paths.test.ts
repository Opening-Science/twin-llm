import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertAllowedGetPath,
  isAllowedGetPath,
  measurementPath,
  modelPath,
  modelsPath,
  tlsCertificatePath,
  viatarListPath,
  viatarPath,
} from "./paths";

const clientSource = readFileSync(join(import.meta.dir, "client.ts"), "utf8");
const pathsSource = readFileSync(join(import.meta.dir, "paths.ts"), "utf8");

describe("vitronic allowlist", () => {
  test("allows the GET paths in the BodyLoop read set", () => {
    expect(isAllowedGetPath(viatarListPath())).toBe(true);
    expect(isAllowedGetPath(viatarPath(42))).toBe(true);
    expect(isAllowedGetPath(measurementPath(42, "heights"))).toBe(true);
    expect(isAllowedGetPath(measurementPath(42, "distances"))).toBe(true);
    expect(isAllowedGetPath(measurementPath(42, "angles"))).toBe(true);
    expect(isAllowedGetPath(measurementPath(42, "crosssections"))).toBe(true);
    expect(isAllowedGetPath(measurementPath(42, "markers"))).toBe(true);
    expect(isAllowedGetPath(measurementPath(42, "axes"))).toBe(true);
    expect(isAllowedGetPath(measurementPath(42, "properties"))).toBe(true);
    expect(isAllowedGetPath(modelsPath(42))).toBe(true);
    expect(isAllowedGetPath(modelPath(42, "avatar_3d.glb"))).toBe(true);
    expect(isAllowedGetPath(modelPath(42, "mesh_3d.glb"))).toBe(true);
    expect(isAllowedGetPath(modelPath(42, "view.glb"))).toBe(true);
    expect(isAllowedGetPath(tlsCertificatePath())).toBe(true);
  });

  test("rejects banned collection paths, password grant, and writes", () => {
    expect(isAllowedGetPath("/api/v2/probands/")).toBe(false);
    expect(isAllowedGetPath("/api/v2/probands/1")).toBe(false);
    expect(isAllowedGetPath("/api/v2/authentification/token")).toBe(false);
    expect(isAllowedGetPath("/api/v2/viatars/42/export")).toBe(false);
    expect(() => assertAllowedGetPath("/api/v2/probands/1")).toThrow(
      "vitronic-path-not-allowed",
    );
    expect(() => modelPath(42, "..")).toThrow("vitronic-model-name-rejected");
    expect(() => modelPath(42, "foo..bar.glb")).toThrow("vitronic-model-name-rejected");
  });

  test("host client source never mentions banned paths or the password client", () => {
    expect(clientSource).not.toContain("/probands");
    expect(clientSource).not.toContain("authentification");
    expect(clientSource.toLowerCase()).not.toContain("password");
    expect(clientSource).not.toContain("createBodyLoopClient");
    expect(pathsSource).not.toContain("/probands");
    expect(pathsSource).not.toContain("authentification");
  });
});
