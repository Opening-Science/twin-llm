import { SBOM_PATH } from "@/infrastructure/local-artefacts";

import { type LabCheck, plural, shortHash } from "./lab-check";

/**
 * The software bill of materials `bun run sbom` writes: whether it exists,
 * how many components it lists, its SHA-256, and whether it still matches the
 * one the current bun.lock gives (the script's output has no timestamp, so
 * the same lockfile gives the same bytes).
 */

/** The component count of a CycloneDX JSON document, or null for anything else. */
export const countSbomComponents = (text: string): number | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { bomFormat, components } = parsed as {
      bomFormat?: unknown;
      components?: unknown;
    };
    return bomFormat === "CycloneDX" && Array.isArray(components)
      ? components.length
      : null;
  } catch {
    return null;
  }
};

export type SbomInput =
  | Readonly<{ kind: "missing" }>
  | Readonly<{
      kind: "found";
      sha256: string;
      components: number | null;
      /** SHA-256 of what `bun run sbom` would write now; null when bun.lock could not be read. */
      currentSha256: string | null;
    }>;

const HOW_TO = `bun run sbom\nsha256sum ${SBOM_PATH}`;

const base = { id: "sbom", title: "Software bill of materials", howTo: HOW_TO } as const;

export const sbomCheck = (input: SbomInput): LabCheck => {
  if (input.kind === "missing") {
    return {
      ...base,
      status: "unknown",
      summary:
        "No SBOM has been written on this machine yet. Run `bun run sbom` and reload.",
      evidence: [{ label: "File", value: SBOM_PATH, mono: true }],
    };
  }
  const evidence = [
    { label: "File", value: SBOM_PATH, mono: true },
    {
      label: "Components",
      value: input.components === null ? "—" : plural(input.components, "component"),
    },
    { label: "SHA-256", value: shortHash(input.sha256, 16), mono: true },
  ];
  if (input.components === null) {
    return {
      ...base,
      status: "not-ok",
      summary:
        "The file is not a CycloneDX document. Run `bun run sbom` to write it again.",
      evidence,
    };
  }
  if (input.currentSha256 === null) {
    return {
      ...base,
      status: "unknown",
      summary: `The SBOM lists ${plural(input.components, "component")}. bun.lock could not be read, so whether it is current is not known.`,
      evidence,
    };
  }
  return input.currentSha256 === input.sha256
    ? {
        ...base,
        status: "ok",
        summary: `The SBOM lists ${plural(input.components, "component")} and matches the current bun.lock byte for byte.`,
        evidence,
      }
    : {
        ...base,
        status: "not-ok",
        summary:
          "The SBOM was written from an older bun.lock. Run `bun run sbom` to bring it up to date.",
        evidence,
      };
};
