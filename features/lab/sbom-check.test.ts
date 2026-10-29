import { describe, expect, test } from "bun:test";

import { countSbomComponents, sbomCheck } from "./sbom-check";

const SHA = "c".repeat(64);

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

describe("sbomCheck", () => {
  test("missing is unknown and names the command", () => {
    const check = sbomCheck({ kind: "missing" });
    expect(check.status).toBe("unknown");
    expect(check.howTo).toBe("bun run sbom\nsha256sum .sbom/twin-llm.cdx.json");
  });

  test("current is ok, with count and hash", () => {
    const check = sbomCheck({
      kind: "found",
      sha256: SHA,
      components: 1174,
      currentSha256: SHA,
    });
    expect(check.status).toBe("ok");
    expect(check.evidence).toEqual([
      { label: "File", value: ".sbom/twin-llm.cdx.json", mono: true },
      { label: "Components", value: "1,174 components" },
      { label: "SHA-256", value: "cccccccccccccccc", mono: true },
    ]);
  });

  test("written from an older lockfile is not ok", () => {
    expect(
      sbomCheck({
        kind: "found",
        sha256: SHA,
        components: 3,
        currentSha256: "d".repeat(64),
      }).status,
    ).toBe("not-ok");
  });

  test("not CycloneDX is not ok", () => {
    expect(
      sbomCheck({ kind: "found", sha256: SHA, components: null, currentSha256: SHA })
        .status,
    ).toBe("not-ok");
  });

  test("lockfile unreadable is unknown", () => {
    expect(
      sbomCheck({ kind: "found", sha256: SHA, components: 3, currentSha256: null })
        .status,
    ).toBe("unknown");
  });
});
