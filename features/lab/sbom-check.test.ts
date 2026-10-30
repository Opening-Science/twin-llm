import { describe, expect, test } from "bun:test";

import { unavailableCheck } from "./lab-check";
import { countSbomComponents, sbomBase, sbomCheck, sbomDrift } from "./sbom-check";

const SHA = "c".repeat(64);

const bom = (version: string, packages: readonly string[]): string =>
  `${JSON.stringify(
    {
      bomFormat: "CycloneDX",
      metadata: { component: { name: "twin-llm", version } },
      components: packages.map((name) => ({ name })),
    },
    null,
    2,
  )}\n`;

const OLD = bom("0.1.0", ["a", "b"]);

const found = (current: Parameters<typeof sbomCheck>[0] & { kind: "found" }) =>
  sbomCheck(current);

describe("countSbomComponents", () => {
  test("counts a CycloneDX document's components", () => {
    expect(
      countSbomComponents(
        JSON.stringify({ bomFormat: "CycloneDX", components: [{}, {}] }),
      ),
    ).toBe(2);
  });
  test("anything else is null", () => {
    expect(countSbomComponents("{")).toBe(null);
    expect(countSbomComponents(JSON.stringify({ spdxVersion: "SPDX-2.3" }))).toBe(null);
    expect(countSbomComponents("null")).toBe(null);
  });
});

describe("sbomDrift", () => {
  test("tells a lockfile change from a package.json change", () => {
    expect(sbomDrift(OLD, bom("0.2.0", ["a", "b"]))).toEqual({
      lockfile: false,
      packageJson: true,
    });
    expect(sbomDrift(OLD, bom("0.1.0", ["a", "c"]))).toEqual({
      lockfile: true,
      packageJson: false,
    });
    expect(sbomDrift(OLD, bom("0.2.0", ["a"]))).toEqual({
      lockfile: true,
      packageJson: true,
    });
  });
});

describe("sbomCheck", () => {
  test("the command hashes the file before writing a fresh one elsewhere", () => {
    const check = sbomCheck({ kind: "missing" });
    expect(check.status).toBe("unknown");
    expect(check.howTo).toBe(
      'sha256sum .sbom/twin-llm.cdx.json\nfresh="$(mktemp)" && bun run sbom --out "$fresh" && sha256sum "$fresh"',
    );
    expect(unavailableCheck(sbomBase).howTo).toBe(check.howTo);
  });

  test("current is ok, with count and hash", () => {
    const check = found({
      kind: "found",
      text: OLD,
      sha256: SHA,
      current: { kind: "built", text: OLD },
    });
    expect(check.status).toBe("ok");
    expect(check.evidence).toEqual([
      { label: "File", value: ".sbom/twin-llm.cdx.json", mono: true },
      { label: "Components", value: "2 components" },
      { label: "SHA-256", value: "cccccccccccccccc", mono: true },
    ]);
  });

  test("an older lockfile is not ok and blamed", () => {
    const check = found({
      kind: "found",
      text: OLD,
      sha256: SHA,
      current: { kind: "built", text: bom("0.1.0", ["a"]) },
    });
    expect(check.status).toBe("not-ok");
    expect(check.summary).toBe(
      "bun.lock changed since the SBOM was written. Run `bun run sbom` to bring it up to date.",
    );
  });

  test("a version bump alone blames package.json, not bun.lock", () => {
    const check = found({
      kind: "found",
      text: OLD,
      sha256: SHA,
      current: { kind: "built", text: bom("0.2.0", ["a", "b"]) },
    });
    expect(check.status).toBe("not-ok");
    expect(check.summary).toBe(
      "The name or version in package.json changed since the SBOM was written; the package list is the same. Run `bun run sbom` to bring it up to date.",
    );
  });

  test("not CycloneDX is not ok", () => {
    expect(
      found({
        kind: "found",
        text: "{}",
        sha256: SHA,
        current: { kind: "built", text: OLD },
      }).status,
    ).toBe("not-ok");
  });

  test("an unreadable input is unknown and named", () => {
    const lock = found({
      kind: "found",
      text: OLD,
      sha256: SHA,
      current: { kind: "unreadable", file: "bun.lock" },
    });
    expect(lock.status).toBe("unknown");
    expect(lock.summary).toBe(
      "The SBOM lists 2 components. bun.lock could not be read, so whether it is current is not known.",
    );
    expect(
      found({
        kind: "found",
        text: OLD,
        sha256: SHA,
        current: { kind: "unreadable", file: "package.json" },
      }).summary,
    ).toBe(
      "The SBOM lists 2 components. package.json could not be read as JSON, so whether it is current is not known.",
    );
  });
});
