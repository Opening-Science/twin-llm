import { SBOM_PATH } from "@/infrastructure/local-artefacts";

import { type LabCheck, plural, shortHash } from "./lab-check";

/**
 * The software bill of materials `bun run sbom` writes: whether it exists,
 * how many components it lists, its SHA-256, and whether it still matches the
 * one the current bun.lock and package.json give (the script's output has no
 * timestamp, so the same inputs give the same bytes), and if not, which of
 * the two changed.
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

/** What `bun run sbom` would write now, or which input could not be read. */
export type CurrentSbom =
  | Readonly<{ kind: "built"; text: string }>
  | Readonly<{ kind: "unreadable"; file: "bun.lock" | "package.json" }>;

export type SbomInput =
  | Readonly<{ kind: "missing" }>
  | Readonly<{
      kind: "found";
      /** The file on disk. */
      text: string;
      sha256: string;
      current: CurrentSbom;
    }>;

export type SbomDrift = Readonly<{ lockfile: boolean; packageJson: boolean }>;

type BomParts = Readonly<{ components: unknown; component: unknown }>;

const partsOf = (text: string): BomParts | null => {
  try {
    const parsed = JSON.parse(text) as {
      components?: unknown;
      metadata?: { component?: unknown };
    } | null;
    return parsed === null
      ? null
      : { components: parsed.components, component: parsed.metadata?.component };
  } catch {
    return null;
  }
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Why two SBOMs differ: the package list comes from bun.lock, the top
 * component's name and version from package.json.
 */
export const sbomDrift = (recorded: string, current: string): SbomDrift => {
  const before = partsOf(recorded);
  const after = partsOf(current);
  if (before === null || after === null) return { lockfile: true, packageJson: true };
  return {
    lockfile: !same(before.components, after.components),
    packageJson: !same(before.component, after.component),
  };
};

const driftText = ({ lockfile, packageJson }: SbomDrift): string =>
  lockfile && packageJson
    ? "bun.lock and the name or version in package.json changed since the SBOM was written."
    : lockfile
      ? "bun.lock changed since the SBOM was written."
      : packageJson
        ? "The name or version in package.json changed since the SBOM was written; the package list is the same."
        : "The SBOM is not byte for byte what `bun run sbom` writes now.";

/**
 * Hashes the file on disk first, then writes a fresh one elsewhere and hashes
 * that, so repeating the check never overwrites the file it is about.
 */
const HOW_TO = [
  `sha256sum ${SBOM_PATH}`,
  'fresh="$(mktemp)" && bun run sbom --out "$fresh" && sha256sum "$fresh"',
].join("\n");

/** What the card shows even when the check cannot run. */
export const sbomBase = {
  id: "sbom",
  title: "Software bill of materials",
  howTo: HOW_TO,
} as const;

const base = sbomBase;

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
  const components = countSbomComponents(input.text);
  const evidence = [
    { label: "File", value: SBOM_PATH, mono: true },
    {
      label: "Components",
      value: components === null ? "—" : plural(components, "component"),
    },
    { label: "SHA-256", value: shortHash(input.sha256, 16), mono: true },
  ];
  if (components === null) {
    return {
      ...base,
      status: "not-ok",
      summary:
        "The file is not a CycloneDX document. Run `bun run sbom` to write it again.",
      evidence,
    };
  }
  const { current } = input;
  if (current.kind === "unreadable") {
    return {
      ...base,
      status: "unknown",
      summary: `The SBOM lists ${plural(components, "component")}. ${current.file === "bun.lock" ? "bun.lock could not be read" : "package.json could not be read as JSON"}, so whether it is current is not known.`,
      evidence,
    };
  }
  return current.text === input.text
    ? {
        ...base,
        status: "ok",
        summary: `The SBOM lists ${plural(components, "component")} and is byte for byte what the current bun.lock and package.json give.`,
        evidence,
      }
    : {
        ...base,
        status: "not-ok",
        summary: `${driftText(sbomDrift(input.text, current.text))} Run \`bun run sbom\` to bring it up to date.`,
        evidence,
      };
};
