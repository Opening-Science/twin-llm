/**
 * Finding Blender for the scripts in scripts/blender/, and saying clearly
 * when it is missing or the wrong series. Pure: the lookups are passed in.
 *
 * The pipeline is pinned to Blender 5.2.x LTS (the Python scripts check it
 * again). CI has no Blender, so a missing binary is a skip, not a failure.
 */

import { delimiter, join } from "node:path";

export const BLENDER_SERIES = { major: 5, minor: 2 } as const;

export type BlenderVersion = Readonly<{ major: number; minor: number; patch: number }>;

export type BlenderLookup = Readonly<{
  /** The value of BLENDER_BIN, if set. */
  envValue: string | undefined;
  /** A command found on PATH, or null. */
  which: (command: string) => string | null;
  exists: (path: string) => boolean;
}>;

export type BlenderBin =
  | Readonly<{ kind: "found"; path: string; from: "BLENDER_BIN" | "PATH" }>
  | Readonly<{ kind: "missing"; message: string }>;

export const resolveBlenderBin = (lookup: BlenderLookup): BlenderBin => {
  const fromEnv = lookup.envValue?.trim();
  if (fromEnv) {
    return lookup.exists(fromEnv)
      ? { kind: "found", path: fromEnv, from: "BLENDER_BIN" }
      : {
          kind: "missing",
          message: `BLENDER_BIN is set to ${fromEnv}, but there is no file there.`,
        };
  }
  const onPath = lookup.which("blender");
  return onPath
    ? { kind: "found", path: onPath, from: "PATH" }
    : {
        kind: "missing",
        message:
          "Blender was not found: set BLENDER_BIN to a Blender 5.2.x binary or put `blender` on PATH. Skipping.",
      };
};

/** The first `command` in the PATH directories that exists, like `which`. */
export const findOnPath = (
  command: string,
  pathValue: string | undefined,
  exists: (path: string) => boolean,
  separator: string = delimiter,
): string | null =>
  (pathValue ?? "")
    .split(separator)
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, command))
    .find(exists) ?? null;

/** "Blender 5.2.3 LTS" (the first line of `blender --version`) → { 5, 2, 3 }. */
export const parseBlenderVersion = (output: string): BlenderVersion | null => {
  const match = /^Blender (\d+)\.(\d+)(?:\.(\d+))?/m.exec(output);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
  };
};

export const isSupportedBlender = (version: BlenderVersion | null): boolean =>
  version !== null &&
  version.major === BLENDER_SERIES.major &&
  version.minor === BLENDER_SERIES.minor;

/** The argument list for a headless run of one script. */
export const blenderArgs = (script: string, args: readonly string[]): string[] => [
  "--background",
  "--factory-startup",
  "--python-exit-code",
  "1",
  "--python",
  script,
  "--",
  ...args,
];
