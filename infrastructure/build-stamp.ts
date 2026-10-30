/**
 * What `next.config.ts` writes into the build for the Lab page's Provenance
 * card, and how the server reads it back. Pure, so the config file (which runs
 * outside Next) and the app share one reading.
 */

const SHA = /^[0-9a-f]{40}$/;

/** The open-twin SHA under "Synced (not vendored) at SHA:" in PROVENANCE.md. */
export const parseOpenTwinPin = (provenance: string): string | null => {
  const match = /Synced \(not vendored\) at SHA:\s*-\s*`([0-9a-f]{40})`/.exec(provenance);
  return match ? match[1] : null;
};

/** `.open-twin/OPEN_TWIN_SHA`: one SHA, maybe with a newline. */
export const parseOpenTwinShaFile = (text: string): string | null => {
  const sha = text.trim().toLowerCase();
  return SHA.test(sha) ? sha : null;
};

/** `git rev-parse HEAD` output as a commit, or null. */
export const parseCommit = (text: string | null): string | null => {
  const sha = text?.trim().toLowerCase() ?? "";
  return SHA.test(sha) ? sha : null;
};

/**
 * `git status --porcelain` output as the build's dirty flag. Null output means
 * the status could not be read, which is "unknown", never "clean".
 */
export const dirtyFlag = (porcelain: string | null): "true" | "false" | "unknown" =>
  porcelain === null ? "unknown" : porcelain.trim() === "" ? "false" : "true";

/** The flag back as true, false or null for unknown. */
export const parseDirtyFlag = (value: string | undefined): boolean | null =>
  value === "true" ? true : value === "false" ? false : null;
