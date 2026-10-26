/**
 * The bake's lockfile must install on every machine setup supports, not only
 * on the one that ran `uv lock --script`. uv does not take
 * `required-environments` in a script's inline metadata, so this checks the
 * lock instead: every package has a wheel for each platform, and torch comes
 * from the PyTorch CPU index on Linux and Windows but from PyPI on macOS (the
 * CPU index has no macOS wheels, which is what failed on an Apple Silicon Mac).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

const LOCK = join(import.meta.dir, "bake-anny-rigged.py.lock");
const SCRIPT = join(import.meta.dir, "bake-anny-rigged.py");

const lockSchema = z.object({
  "requires-python": z.string(),
  "resolution-markers": z.array(z.string()).optional(),
  package: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      source: z.object({ registry: z.string() }),
      "resolution-markers": z.array(z.string()).optional(),
      wheels: z.array(z.object({ url: z.string() })).optional(),
    }),
  ),
});

const lock = lockSchema.parse(Bun.TOML.parse(readFileSync(LOCK, "utf8")));

const CPU_INDEX = "https://download.pytorch.org/whl/cpu";
const PYPI = "https://pypi.org/simple";
const LINUX_OR_WINDOWS = "sys_platform == 'linux' or sys_platform == 'win32'";
const ELSEWHERE = "sys_platform != 'linux' and sys_platform != 'win32'";

type Platform = Readonly<{
  name: string;
  sysPlatform: "darwin" | "linux" | "win32";
  /** Matches a wheel's platform tag for this machine. */
  tag: (tag: string) => boolean;
}>;

/** The platforms setup supports; macOS needs Apple Silicon and macOS 14, torch's only macOS wheel. */
const PLATFORMS: readonly Platform[] = [
  {
    name: "macOS 14+ arm64",
    sysPlatform: "darwin",
    tag: (tag) => {
      const match = /^macosx_(\d+)_\d+_(arm64|universal2)$/.exec(tag);
      return match !== null && Number(match[1]) <= 14;
    },
  },
  {
    name: "Linux x86_64",
    sysPlatform: "linux",
    tag: (tag) => /^manylinux_2_(\d+)_x86_64$|^manylinux\d+_x86_64$/.test(tag),
  },
  {
    name: "Linux aarch64",
    sysPlatform: "linux",
    tag: (tag) => /^manylinux_2_(\d+)_aarch64$|^manylinux\d+_aarch64$/.test(tag),
  },
  { name: "Windows x86_64", sysPlatform: "win32", tag: (tag) => tag === "win_amd64" },
];

/** Python and platform tags of a wheel file name (PEP 427), with compressed tag sets split. */
const wheelTags = (
  url: string,
): Readonly<{ python: readonly string[]; platforms: readonly string[] }> => {
  const file = decodeURIComponent(url.split("/").at(-1) ?? "").replace(/\.whl$/, "");
  const parts = file.split("-");
  const [python = "", abi = "", platform = ""] = parts.slice(-3);
  return {
    python: [...python.split("."), ...(abi === "abi3" ? ["abi3"] : [])],
    platforms: platform.split("."),
  };
};

const installsOnPython312 = (python: readonly string[]): boolean =>
  python.some((tag) => tag === "cp312" || tag === "py3" || tag === "abi3");

/** The lock entry uv installs for a package on this platform (torch has one per index). */
const entryFor = (name: string, platform: Platform) =>
  lock.package.filter((entry) => {
    if (entry.name !== name) return false;
    const markers = entry["resolution-markers"];
    if (!markers) return true;
    const linuxOrWindows = platform.sysPlatform !== "darwin";
    return markers.includes(linuxOrWindows ? LINUX_OR_WINDOWS : ELSEWHERE);
  });

describe("bake-anny-rigged.py.lock", () => {
  test("splits only on the operating system, as the script's torch source says", () => {
    expect(lock["requires-python"]).toBe("==3.12.*");
    expect(lock["resolution-markers"]).toEqual([LINUX_OR_WINDOWS, ELSEWHERE]);
    const script = readFileSync(SCRIPT, "utf8");
    expect(script).toContain(
      `#   { index = "pytorch-cpu", marker = "${LINUX_OR_WINDOWS}" },`,
    );
    expect(script).toContain('#   "torch==2.14.1",');
  });

  test("torch is the CPU build on Linux and Windows and PyPI's on macOS", () => {
    const torch = (platform: Platform) =>
      entryFor("torch", platform).map(
        (entry) => `${entry.version} ${entry.source.registry}`,
      );
    const [mac, linux, linuxArm, windows] = PLATFORMS;
    if (!mac || !linux || !linuxArm || !windows) throw new Error("platform list changed");
    expect(torch(mac)).toEqual([`2.14.1 ${PYPI}`]);
    expect(torch(linux)).toEqual([`2.14.1+cpu ${CPU_INDEX}`]);
    expect(torch(linuxArm)).toEqual([`2.14.1+cpu ${CPU_INDEX}`]);
    expect(torch(windows)).toEqual([`2.14.1+cpu ${CPU_INDEX}`]);
  });

  test("every package has a Python 3.12 wheel for every supported platform", () => {
    const names = [...new Set(lock.package.map((entry) => entry.name))];
    const missing = PLATFORMS.flatMap((platform) =>
      names.flatMap((name) => {
        const usable = entryFor(name, platform).some((entry) =>
          (entry.wheels ?? []).some((wheel) => {
            const tags = wheelTags(wheel.url);
            return (
              installsOnPython312(tags.python) &&
              tags.platforms.some((tag) => tag === "any" || platform.tag(tag))
            );
          }),
        );
        return usable ? [] : [`${name} on ${platform.name}`];
      }),
    );
    expect(missing).toEqual([]);
  });
});
