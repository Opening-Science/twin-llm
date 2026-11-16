/**
 * A CycloneDX 1.6 bill of materials for the app, built from `bun.lock` and
 * `package.json` with no extra tool. Pure: `bun run sbom`
 * (`scripts/sbom/write.ts`) reads the files and writes the result, and the
 * Lab page rebuilds it in memory to see whether the written file is current.
 *
 * Every package the lockfile resolves is listed once by name and version,
 * with its npm integrity hash as hex SHA-512 where the lockfile has one.
 * Local `file:` packages (the open-twin pins) have no registry hash; their
 * source path is kept as a property instead. There is no timestamp or serial
 * number, so the same lockfile always gives the same bytes and the same
 * SHA-256.
 */

export type BomHash = Readonly<{ alg: "SHA-512"; content: string }>;

export type BomComponent = Readonly<{
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  purl?: string;
  hashes?: readonly BomHash[];
  properties?: readonly Readonly<{ name: string; value: string }>[];
}>;

export type Bom = Readonly<{
  bomFormat: "CycloneDX";
  specVersion: "1.6";
  version: 1;
  metadata: Readonly<{
    tools: Readonly<{
      components: readonly Readonly<{ type: "application"; name: string }>[];
    }>;
    component: Readonly<{
      type: "application";
      "bom-ref": string;
      name: string;
      version: string;
    }>;
  }>;
  components: readonly BomComponent[];
}>;

/**
 * bun.lock is JSON with trailing commas; drop those and parse. No string in a
 * lockfile (names, versions, integrity hashes) contains `,}` or `,]`.
 */
export const parseBunLock = (text: string): unknown =>
  JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));

/** `@scope/name@1.2.3` → name and version; the first `@` of a scope is not the split. */
export const splitSpec = (
  spec: string,
): Readonly<{ name: string; version: string }> | null => {
  const at = spec.indexOf("@", 1);
  if (at <= 0 || at === spec.length - 1) return null;
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
};

/** npm's `sha512-<base64>` integrity as lower-case hex, or null for anything else. */
export const integrityToHex = (integrity: string): string | null => {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  return match ? Buffer.from(match[1], "base64").toString("hex") : null;
};

/** Package URL for an npm package; scopes are percent-encoded (`%40scope/name`). */
export const npmPurl = (name: string, version: string): string =>
  `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;

const LOCAL_SOURCE = /^(file|link|workspace):/;

const componentOf = (entry: unknown): BomComponent | null => {
  if (!Array.isArray(entry) || typeof entry[0] !== "string") return null;
  const spec = splitSpec(entry[0]);
  if (spec === null) return null;
  if (LOCAL_SOURCE.test(spec.version)) {
    return {
      type: "library",
      "bom-ref": `${spec.name}@${spec.version}`,
      name: spec.name,
      version: spec.version,
      properties: [{ name: "bun:source", value: spec.version }],
    };
  }
  const integrity = entry.findLast(
    (part: unknown): part is string =>
      typeof part === "string" && part.startsWith("sha512-"),
  );
  const hex = integrity === undefined ? null : integrityToHex(integrity);
  const purl = npmPurl(spec.name, spec.version);
  return {
    type: "library",
    "bom-ref": purl,
    name: spec.name,
    version: spec.version,
    purl,
    ...(hex === null ? {} : { hashes: [{ alg: "SHA-512", content: hex }] }),
  };
};

const byNameThenVersion = (a: BomComponent, b: BomComponent): number =>
  a.name === b.name
    ? a.version < b.version
      ? -1
      : a.version > b.version
        ? 1
        : 0
    : a.name < b.name
      ? -1
      : 1;

export const buildBom = (
  lock: unknown,
  app: Readonly<{ name: string; version: string }>,
): Bom => {
  const packages =
    typeof lock === "object" && lock !== null && "packages" in lock
      ? (lock as { packages: unknown }).packages
      : null;
  if (typeof packages !== "object" || packages === null) {
    throw new Error("bun.lock has no packages table");
  }
  const unique = new Map(
    Object.values(packages)
      .map(componentOf)
      .filter((component): component is BomComponent => component !== null)
      .map((component) => [component["bom-ref"], component] as const),
  );
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      tools: { components: [{ type: "application", name: "twin-llm scripts/sbom" }] },
      component: {
        type: "application",
        "bom-ref": `${app.name}@${app.version}`,
        name: app.name,
        version: app.version,
      },
    },
    components: [...unique.values()].sort(byNameThenVersion),
  };
};

/** The bytes `bun run sbom` writes, so a reader can rebuild and compare them. */
export const bomText = (bom: Bom): string => `${JSON.stringify(bom, null, 2)}\n`;
