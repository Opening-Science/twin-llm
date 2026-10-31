import { describe, expect, test } from "bun:test";

import {
  capText,
  DEFAULT_SANDBOX_LIMITS,
  lddPaths,
  PROBE_LIMITS,
  probeOutcome,
  PYTHON_BOOTSTRAP,
  type PythonLayout,
  SANDBOX_INPUT_PATH,
  SANDBOX_PROBES,
  type SandboxResult,
  sandboxArgv,
} from "./code-sandbox";

const LAYOUT: PythonLayout = {
  executable: "/usr/bin/python3.14",
  version: "Python 3.14.7",
  stdlib: "/usr/lib/python3.14",
  hidden: ["/usr/lib/python3.14/site-packages"],
  libraries: [
    { source: "/usr/lib/libc.so.6", target: "/usr/lib/libc.so.6" },
    {
      source: "/usr/lib/ld-linux-x86-64.so.2",
      target: "/lib64/ld-linux-x86-64.so.2",
    },
  ],
};

const result = (over: Partial<SandboxResult> = {}): SandboxResult => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  outputCapped: false,
  stdout: "contained\n",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
  ms: 40,
  ...over,
});

describe("lddPaths", () => {
  test("both sides of the loader line, the right side of a library, no vdso or missing", () => {
    expect(
      lddPaths(
        [
          "\tlinux-vdso.so.1 (0x00007ffd)",
          "\tlibpython3.14.so.1.0 => /usr/lib/libpython3.14.so.1.0 (0x0000)",
          "\tlibmpdec.so.4 => not found",
          "\t/lib64/ld-linux-x86-64.so.2 => /usr/lib64/ld-linux-x86-64.so.2 (0x0000)",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "/usr/lib/libpython3.14.so.1.0",
      "/lib64/ld-linux-x86-64.so.2",
      "/usr/lib64/ld-linux-x86-64.so.2",
    ]);
  });
});

describe("sandboxArgv", () => {
  const argv = sandboxArgv(
    LAYOUT,
    "/tmp/x/subject.json",
    "unit-1",
    DEFAULT_SANDBOX_LIMITS,
  );
  const joined = argv.join(" ");

  test("a systemd scope with memory, tasks and runtime caps, then prlimit, then bwrap", () => {
    expect(argv.slice(0, 6)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--unit=unit-1",
    ]);
    expect(joined).toContain(`MemoryMax=${DEFAULT_SANDBOX_LIMITS.memoryBytes}`);
    expect(joined).toContain("MemorySwapMax=0");
    expect(joined).toContain(`TasksMax=${DEFAULT_SANDBOX_LIMITS.tasks}`);
    expect(joined).toContain("RuntimeMaxSec=20");
    expect(joined).toContain(
      `prlimit --cpu=10 --fsize=${DEFAULT_SANDBOX_LIMITS.workBytes} --nofile=64 --core=0 -- bwrap`,
    );
  });

  test("no network, no environment, no nested namespaces, no capabilities", () => {
    for (const flag of [
      "--unshare-all",
      "--unshare-user",
      "--disable-userns",
      "--die-with-parent",
      "--new-session",
      "--clearenv",
    ]) {
      expect(argv).toContain(flag);
    }
    expect(joined).toContain("--cap-drop ALL");
    expect(argv).not.toContain("--share-net");
    expect(argv).not.toContain("--proc");
    expect(argv).not.toContain("--dev");
    expect(argv).not.toContain("--bind");
  });

  test("only the interpreter, its libraries and the input file, read-only; a capped tmpfs to write", () => {
    const binds = argv.flatMap((arg, index) =>
      arg === "--ro-bind" ? [`${argv[index + 1]} -> ${argv[index + 2]}`] : [],
    );
    expect(binds).toEqual([
      "/usr/bin/python3.14 -> /usr/bin/python3",
      "/usr/lib/python3.14 -> /usr/lib/python3.14",
      "/usr/lib/libc.so.6 -> /usr/lib/libc.so.6",
      "/usr/lib/ld-linux-x86-64.so.2 -> /lib64/ld-linux-x86-64.so.2",
      `/tmp/x/subject.json -> ${SANDBOX_INPUT_PATH}`,
    ]);
    expect(joined).toContain(
      "--tmpfs /usr/lib/python3.14/site-packages --remount-ro /usr/lib/python3.14/site-packages",
    );
    expect(joined).toContain(`--size ${DEFAULT_SANDBOX_LIMITS.workBytes} --tmpfs /work`);
    expect(joined).toContain("--remount-ro /");
    expect(argv.slice(-6)).toEqual([
      "/usr/bin/python3",
      "-I",
      "-S",
      "-B",
      "-c",
      PYTHON_BOOTSTRAP,
    ]);
  });

  test("the bootstrap clears the environment and reads the program from stdin", () => {
    expect(PYTHON_BOOTSTRAP).toContain("os.environ.clear()");
    expect(PYTHON_BOOTSTRAP).toContain("sys.stdin.read()");
  });
});

describe("capText", () => {
  test("keeps the start and says when it cut", () => {
    expect(capText("abcdef", 4)).toEqual({ text: "abcd", truncated: true });
    expect(capText("ab", 4)).toEqual({ text: "ab", truncated: false });
  });
});

describe("probe verdicts", () => {
  const probe = (name: string) => {
    const found = SANDBOX_PROBES.find((entry) => entry.name === name);
    if (found === undefined) throw new Error(name);
    return found;
  };

  test("a probe that reached something is not contained", () => {
    expect(
      probeOutcome(
        probe("no network"),
        result({ stdout: "reached 1.1.1.1\n" }),
        PROBE_LIMITS,
      ),
    ).toEqual({ name: "no network", contained: false, ended: "exit 0" });
    expect(
      probe("host files unreadable").contained(
        result({ stdout: "read /home/x\n" }),
        PROBE_LIMITS,
      ),
    ).toBe(false);
    expect(probe("empty environment").contained(result(), PROBE_LIMITS)).toBe(true);
  });

  test("a loop that ends by itself, or long after the limit, is not contained", () => {
    const loop = probe("infinite loop killed");
    expect(loop.contained(result({ exitCode: 0 }), PROBE_LIMITS)).toBe(false);
    expect(
      loop.contained(
        result({ exitCode: null, signal: "SIGKILL", timedOut: true, ms: 60_000 }),
        PROBE_LIMITS,
      ),
    ).toBe(false);
    expect(
      probeOutcome(
        loop,
        result({ exitCode: null, signal: "SIGKILL", timedOut: true, ms: 3_050 }),
        PROBE_LIMITS,
      ),
    ).toEqual({ name: "infinite loop killed", contained: true, ended: "wall clock" });
  });

  test("huge output needs the read cap to have fired and stdout kept short", () => {
    const output = probe("huge output capped");
    expect(
      output.contained(
        result({ exitCode: null, signal: "SIGKILL", outputCapped: true, stdout: "x" }),
        PROBE_LIMITS,
      ),
    ).toBe(true);
    expect(
      output.contained(
        result({ exitCode: null, signal: "SIGKILL", outputCapped: false }),
        PROBE_LIMITS,
      ),
    ).toBe(false);
  });

  test("every probe program names the paths it tries", () => {
    const host = { home: "/home/someone", repo: "/home/someone/repo" };
    const text = SANDBOX_PROBES.map((entry) => entry.program(host)).join("\n");
    expect(text).toContain('"/home/someone"');
    expect(text).toContain('"/home/someone/repo"');
    expect(text).toContain("CLONE_NEWUSER");
  });
});
