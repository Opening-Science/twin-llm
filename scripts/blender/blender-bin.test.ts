import { describe, expect, test } from "bun:test";

import {
  blenderArgs,
  findOnPath,
  isSupportedBlender,
  parseBlenderVersion,
  resolveBlenderBin,
} from "./blender-bin";

const lookup = (
  envValue: string | undefined,
  onPath: string | null,
  files: readonly string[],
) => ({
  envValue,
  which: (command: string) => (command === "blender" ? onPath : null),
  exists: (path: string) => files.includes(path),
});

describe("resolveBlenderBin", () => {
  test("BLENDER_BIN wins over PATH when the file exists", () => {
    expect(
      resolveBlenderBin(
        lookup("/opt/blender-5.2/blender", "/usr/bin/blender", [
          "/opt/blender-5.2/blender",
        ]),
      ),
    ).toEqual({ kind: "found", path: "/opt/blender-5.2/blender", from: "BLENDER_BIN" });
  });

  test("a BLENDER_BIN that points nowhere is reported, not replaced by PATH", () => {
    expect(resolveBlenderBin(lookup("/nope/blender", "/usr/bin/blender", []))).toEqual({
      kind: "missing",
      message: "BLENDER_BIN is set to /nope/blender, but there is no file there.",
    });
  });

  test("falls back to blender on PATH", () => {
    expect(resolveBlenderBin(lookup(undefined, "/usr/bin/blender", []))).toEqual({
      kind: "found",
      path: "/usr/bin/blender",
      from: "PATH",
    });
  });

  test("an empty BLENDER_BIN counts as unset", () => {
    expect(resolveBlenderBin(lookup("  ", null, []))).toEqual({
      kind: "missing",
      message:
        "Blender was not found: set BLENDER_BIN to a Blender 5.2.x binary or put `blender` on PATH. Skipping.",
    });
  });
});

describe("parseBlenderVersion and isSupportedBlender", () => {
  test("reads the first line of blender --version", () => {
    const version = parseBlenderVersion("Blender 5.2.3 LTS\n\tbuild date: 2026-10-22\n");
    expect(version).toEqual({ major: 5, minor: 2, patch: 3 });
    expect(isSupportedBlender(version)).toBe(true);
  });

  test("only the 5.2 series is supported", () => {
    expect(isSupportedBlender(parseBlenderVersion("Blender 5.1.0"))).toBe(false);
    expect(isSupportedBlender(parseBlenderVersion("Blender 4.2.9 LTS"))).toBe(false);
    expect(isSupportedBlender(parseBlenderVersion("Blender 5.2"))).toBe(true);
  });

  test("unreadable output is no version", () => {
    expect(parseBlenderVersion("command not found")).toBeNull();
    expect(isSupportedBlender(null)).toBe(false);
  });
});

test("blenderArgs runs one script headless and passes its arguments after --", () => {
  expect(blenderArgs("/repo/scripts/blender/fit_atlas.py", ["--self-check"])).toEqual([
    "--background",
    "--factory-startup",
    "--python-exit-code",
    "1",
    "--python",
    "/repo/scripts/blender/fit_atlas.py",
    "--",
    "--self-check",
  ]);
});

test("findOnPath takes the first PATH directory that has the command", () => {
  const files = ["/opt/b/blender", "/usr/bin/blender"];
  expect(
    findOnPath("blender", "/nope::/opt/b:/usr/bin", (p) => files.includes(p), ":"),
  ).toBe("/opt/b/blender");
  expect(findOnPath("blender", undefined, () => true, ":")).toBeNull();
});
