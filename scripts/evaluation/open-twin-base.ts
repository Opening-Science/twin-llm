import { readFileSync } from "node:fs";

/**
 * The open-twin commit the copied packages were taken from, for the
 * `open_twin_sha` of answer keys and eval results. Read from
 * packages/open-twin/UPSTREAM.json; it was `git -C .open-twin rev-parse HEAD`
 * while the packages were synced.
 */

const SHA = /^[0-9a-f]{40}$/;

/** UPSTREAM.json's one base commit; throws when packages sit at different ones. */
export const parseOpenTwinBase = (text: string): string => {
  const { packages } = JSON.parse(text) as {
    packages?: Readonly<Record<string, { base?: unknown }>>;
  };
  const bases = [...new Set(Object.values(packages ?? {}).map((entry) => entry.base))];
  if (bases.length !== 1 || typeof bases[0] !== "string" || !SHA.test(bases[0])) {
    throw new Error(
      "packages/open-twin/UPSTREAM.json does not name one open-twin commit for every package",
    );
  }
  return bases[0];
};

export const openTwinBase = (path = "packages/open-twin/UPSTREAM.json"): string =>
  parseOpenTwinBase(readFileSync(path, "utf8"));
