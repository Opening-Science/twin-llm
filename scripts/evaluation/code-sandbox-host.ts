/**
 * The host side of the code arm's sandbox (#303): finds the interpreter and
 * the files it needs, writes each item's input file to a private temporary
 * directory, and runs programs through `sandboxArgv`. Throws when bubblewrap,
 * systemd-run, prlimit or Python is missing; the harness then refuses the arm.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type CodeSandbox,
  DEFAULT_SANDBOX_LIMITS,
  lddPaths,
  PROBE_INPUT,
  PROBE_LIMITS,
  probeOutcome,
  type PythonLayout,
  SANDBOX_PROBES,
  type SandboxLimits,
  sandboxArgv,
  spawnSandbox,
} from "./code-sandbox";

/** The host interpreter; fixed so no PATH lookup decides what runs. */
export const HOST_PYTHON = "/usr/bin/python3";

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** The interpreter, its standard library and every shared library they link. */
export const discoverPython = (python: string = HOST_PYTHON): PythonLayout => {
  const executable = realpathSync(python);
  const [version = "", stdlib = "", dynload = ""] = run(executable, [
    "-I",
    "-S",
    "-c",
    "import sys, sysconfig; print(sys.version.split()[0]); print(sysconfig.get_paths()['stdlib']); print(sysconfig.get_config_var('DESTSHARED') or '')",
  ])
    .trim()
    .split("\n");
  const extensions =
    dynload !== "" && existsSync(dynload)
      ? readdirSync(dynload)
          .filter((name) => name.endsWith(".so"))
          .map((name) => join(dynload, name))
      : [];
  const linked = [executable, ...extensions].flatMap((file) => {
    try {
      return lddPaths(run("ldd", [file]));
    } catch {
      return [];
    }
  });
  const inside = (path: string) => path === stdlib || path.startsWith(`${stdlib}/`);
  const targets = [...new Set(linked)].filter((path) => !inside(path)).sort();
  const sitePackages = join(stdlib, "site-packages");
  const distPackages = join(stdlib, "dist-packages");
  return {
    executable,
    version: `Python ${version}`,
    stdlib,
    hidden: [sitePackages, distPackages].filter((dir) => existsSync(dir)),
    libraries: targets.map((target) => ({ source: realpathSync(target), target })),
  };
};

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

let unitCounter = 0;
const newUnit = (): string => {
  unitCounter += 1;
  return `twin-eval-code-${process.pid}-${unitCounter}-${randomBytes(4).toString("hex")}`;
};

/** The sandbox on this host, or a throw naming what is missing. */
export const createHostSandbox = (
  limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS,
): CodeSandbox => {
  const layout = discoverPython();
  const bwrap = firstLine(run("bwrap", ["--version"]));
  run("systemd-run", ["--version"]);
  run("prlimit", ["--version"]);

  const openWith = async (inputJson: string, runLimits: SandboxLimits) => {
    const dir = await mkdtemp(join(tmpdir(), "twin-eval-code-"));
    const input = join(dir, "subject.json");
    await writeFile(input, inputJson);
    await chmod(input, 0o444);
    return {
      run: (code: string) => {
        const unit = newUnit();
        return spawnSandbox(
          sandboxArgv(layout, input, unit, runLimits),
          code,
          runLimits,
          unit,
        );
      },
      close: () => rm(dir, { recursive: true, force: true }),
    };
  };

  return {
    info: {
      language: "python",
      interpreter: layout.version,
      sandbox: `${bwrap}; systemd user scope; prlimit`,
      limits,
    },
    selfCheck: async (host) => {
      const session = await openWith(PROBE_INPUT, PROBE_LIMITS);
      try {
        const outcomes = [];
        for (const probe of SANDBOX_PROBES) {
          const result = await session.run(probe.program(host));
          outcomes.push(probeOutcome(probe, result, PROBE_LIMITS));
        }
        return outcomes;
      } finally {
        await session.close();
      }
    },
    open: (inputJson) => openWith(inputJson, limits),
  };
};
