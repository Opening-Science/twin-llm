/**
 * The sandbox behind the code arm of the eval harness (#303): a Python
 * program the model wrote runs with no network, no view of the host's files
 * and a hard limit on time, memory, processes and output.
 *
 * Layers, each on its own:
 *
 * - bubblewrap (`bwrap`): every namespace unshared (no `--share-net`, so only
 *   a loopback with nothing on it), a new user namespace that cannot nest
 *   another, all capabilities dropped, an empty environment, a new session
 *   (no terminal to inject into) and death with the parent. The root is an
 *   empty tmpfs remounted read-only; into it go, read-only, the interpreter,
 *   its standard library (site-packages hidden), the shared libraries they
 *   link and the one input file at `/data/subject.json`. The only writable
 *   place is a fresh, size-capped tmpfs at `/work`. No `/proc`, no `/dev`,
 *   no home, no repository, no caches.
 * - a transient systemd user scope: memory (no swap), task count and CPU
 *   share, and a runtime cap as a backstop to the wall clock.
 * - `prlimit`: CPU seconds, file size, open files, no core dumps.
 * - the caller: a wall-clock kill (the scope is killed too) and a cap on the
 *   bytes read from stdout and stderr.
 *
 * `SANDBOX_PROBES` are escape attempts that must all be contained before any
 * model code runs: the harness runs them at the start of every code-arm run
 * and refuses to start when one is not, and `code-sandbox.escape.test.ts`
 * runs them in `bun test`. Synthetic data only.
 */
import { spawn } from "node:child_process";

/** The limits of one program run. */
export type SandboxLimits = Readonly<{
  /** Wall clock, killed after. */
  wallMs: number;
  /** RLIMIT_CPU. */
  cpuSeconds: number;
  /** MemoryMax of the scope; swap is off. */
  memoryBytes: number;
  /** TasksMax of the scope: processes and threads. */
  tasks: number;
  /** Size of the `/work` tmpfs, and RLIMIT_FSIZE. */
  workBytes: number;
  /** Bytes read from stdout or stderr before the run is killed. */
  readBytes: number;
  /** Characters of stdout kept (and shown to the model). */
  stdoutChars: number;
  /** Characters of stderr kept (and shown to the model). */
  stderrChars: number;
}>;

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  wallMs: 15_000,
  cpuSeconds: 10,
  memoryBytes: 256 * 1024 * 1024,
  tasks: 16,
  workBytes: 16 * 1024 * 1024,
  readBytes: 256 * 1024,
  stdoutChars: 4_000,
  stderrChars: 2_000,
};

/** Where the program finds its input, inside the sandbox. */
export const SANDBOX_INPUT_PATH = "/data/subject.json";
export const SANDBOX_WORK_DIR = "/work";
/** The interpreter's path inside the sandbox. */
export const SANDBOX_PYTHON = "/usr/bin/python3";

/** What the host has: the interpreter and every file it needs, found once per run. */
export type PythonLayout = Readonly<{
  /** The real interpreter on the host. */
  executable: string;
  /** e.g. `Python 3.14.7`. */
  version: string;
  /** The standard library directory, bound read-only. */
  stdlib: string;
  /** Directories inside `stdlib` hidden by an empty tmpfs (site-packages). */
  hidden: readonly string[];
  /** Shared libraries: host file and the path it is linked by. */
  libraries: readonly Readonly<{ source: string; target: string }>[];
}>;

/**
 * The absolute paths an `ldd` listing names, as the loader looks them up:
 * `libc.so.6 => /usr/lib/libc.so.6 (0x…)` gives `/usr/lib/libc.so.6`,
 * `/lib64/ld-linux-x86-64.so.2 => /usr/lib64/ld-linux-x86-64.so.2 (0x…)`
 * gives both sides. `linux-vdso.so.1` and `not found` lines give none.
 */
export const lddPaths = (text: string): string[] =>
  text.split("\n").flatMap((raw) => {
    const line = raw.trim();
    if (line.length === 0 || line.includes("not found")) return [];
    const [left = "", right = ""] = line.split("=>").map((part) => part.trim());
    const pathOf = (part: string): string | null => {
      const token = part.split(/\s+/)[0] ?? "";
      return token.startsWith("/") ? token : null;
    };
    return [pathOf(left), pathOf(right)].flatMap((path) => (path === null ? [] : [path]));
  });

/**
 * Wraps the program so it starts with no environment (bubblewrap always sets
 * PWD) in the work directory, reading its source from stdin.
 */
export const PYTHON_BOOTSTRAP = [
  "import os, sys",
  "os.environ.clear()",
  `os.chdir(${JSON.stringify(SANDBOX_WORK_DIR)})`,
  "source = sys.stdin.read()",
  "sys.stdin = open(os.devnull) if os.path.exists(os.devnull) else None",
  "exec(compile(source, 'program.py', 'exec'), {'__name__': '__main__'})",
].join("\n");

/**
 * The whole command line of one run: systemd scope, prlimit, bubblewrap,
 * Python. Pure, so the flags are tested without running anything.
 */
export const sandboxArgv = (
  layout: PythonLayout,
  inputPath: string,
  unit: string,
  limits: SandboxLimits,
): string[] => {
  const runtimeMaxSec = Math.ceil(limits.wallMs / 1000) + 5;
  const binds = [
    ["--ro-bind", layout.executable, SANDBOX_PYTHON],
    ["--ro-bind", layout.stdlib, layout.stdlib],
    ...layout.hidden.flatMap((dir) => [
      ["--tmpfs", dir],
      ["--remount-ro", dir],
    ]),
    ...layout.libraries.map((lib) => ["--ro-bind", lib.source, lib.target]),
    ["--ro-bind", inputPath, SANDBOX_INPUT_PATH],
    ["--size", String(limits.workBytes), "--tmpfs", SANDBOX_WORK_DIR],
    ["--remount-ro", "/"],
  ].flat();
  return [
    "systemd-run",
    "--user",
    "--scope",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    "-p",
    `MemoryMax=${limits.memoryBytes}`,
    "-p",
    "MemorySwapMax=0",
    "-p",
    `TasksMax=${limits.tasks}`,
    "-p",
    "CPUQuota=100%",
    "-p",
    `RuntimeMaxSec=${runtimeMaxSec}`,
    "--",
    "prlimit",
    `--cpu=${limits.cpuSeconds}`,
    `--fsize=${limits.workBytes}`,
    "--nofile=64",
    "--core=0",
    "--",
    "bwrap",
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--cap-drop",
    "ALL",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--hostname",
    "sandbox",
    ...binds,
    SANDBOX_PYTHON,
    "-I",
    "-S",
    "-B",
    "-c",
    PYTHON_BOOTSTRAP,
  ];
};

/** What one run gave back. Never host paths or host text beyond the program's own output. */
export type SandboxResult = Readonly<{
  /** Exit code; null when killed by a signal. */
  exitCode: number | null;
  signal: string | null;
  /** Killed at the wall clock. */
  timedOut: boolean;
  /** Killed for writing more than `readBytes`. */
  outputCapped: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  ms: number;
}>;

/** Why a run gave no usable result (`codeRunError` in `code-arm.ts`). */
export const CODE_RUN_ERRORS = [
  "TIMEOUT",
  "OUTPUT_CAP",
  "KILLED",
  "EXIT_NONZERO",
  "NO_OUTPUT",
  "SANDBOX_FAILED",
] as const;

/** Keeps the first `chars` characters and says whether more came. */
export const capText = (
  text: string,
  chars: number,
): Readonly<{ text: string; truncated: boolean }> =>
  text.length <= chars
    ? { text, truncated: false }
    : { text: text.slice(0, chars), truncated: true };

export type SpawnSandbox = (
  argv: readonly string[],
  stdin: string,
  limits: SandboxLimits,
  unit: string,
) => Promise<SandboxResult>;

/**
 * Runs one command line with the wall clock and the read cap. On either
 * limit the process is killed and the scope with it, so nothing it forked
 * outlives the run.
 */
export const spawnSandbox: SpawnSandbox = (argv, stdin, limits, unit) =>
  new Promise((resolve) => {
    const started = performance.now();
    const [command = "", ...args] = argv;
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let outputCapped = false;
    let done = false;
    const killAll = () => {
      child.kill("SIGKILL");
      spawn("systemctl", ["--user", "kill", "--signal=SIGKILL", `${unit}.scope`], {
        stdio: "ignore",
      }).on("error", () => undefined);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killAll();
    }, limits.wallMs);
    const take = (chunks: Buffer[], chunk: Buffer, total: number): number => {
      if (total < limits.readBytes) chunks.push(chunk);
      const next = total + chunk.length;
      if (next > limits.readBytes && !outputCapped) {
        outputCapped = true;
        killAll();
      }
      return next;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      outBytes = take(out, chunk, outBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errBytes = take(err, chunk, errBytes);
    });
    const finish = (code: number | null, signal: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stdout = capText(Buffer.concat(out).toString("utf8"), limits.stdoutChars);
      const stderr = capText(Buffer.concat(err).toString("utf8"), limits.stderrChars);
      resolve({
        exitCode: code,
        signal,
        timedOut,
        outputCapped,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated || outputCapped,
        stderrTruncated: stderr.truncated,
        ms: Math.round(performance.now() - started),
      });
    };
    child.on("error", () => finish(null, "SPAWN_FAILED"));
    child.on("close", (code, signal) => finish(code, signal));
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });

/** One escape attempt and what a contained run looks like. */
export type SandboxProbe = Readonly<{
  name: string;
  program: (host: ProbeHost) => string;
  contained: (result: SandboxResult, limits: SandboxLimits) => boolean;
}>;

/** Host paths the probes try to reach. */
export type ProbeHost = Readonly<{ home: string; repo: string }>;

const printedOk = (result: SandboxResult): boolean =>
  result.exitCode === 0 && result.stdout.trim() === "contained";

/**
 * The escape attempts. Each prints `contained` only when every attempt in it
 * failed; the resource probes are judged by how the run ended.
 */
export const SANDBOX_PROBES: readonly SandboxProbe[] = [
  {
    name: "input file readable",
    program: () =>
      [
        "import json",
        `data = json.load(open(${JSON.stringify(SANDBOX_INPUT_PATH)}))`,
        "print('contained' if data.get('probe') == 1 else 'wrong input')",
      ].join("\n"),
    contained: printedOk,
  },
  {
    name: "no network",
    program: () =>
      [
        "import socket",
        "reached = []",
        "for host, port in [('1.1.1.1', 53), ('8.8.8.8', 443), ('127.0.0.1', 11434), ('127.0.0.1', 5434)]:",
        "    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)",
        "    s.settimeout(2)",
        "    try:",
        "        s.connect((host, port))",
        "        reached.append(host)",
        "    except OSError:",
        "        pass",
        "    finally:",
        "        s.close()",
        "try:",
        "    socket.getaddrinfo('example.org', 443)",
        "    reached.append('dns')",
        "except OSError:",
        "    pass",
        "print('contained' if not reached else 'reached ' + ','.join(reached))",
      ].join("\n"),
    contained: printedOk,
  },
  {
    name: "host files unreadable",
    program: (host) =>
      [
        "import os",
        `paths = [${[host.home, host.repo, "/etc/passwd", "/etc", "/root", "/tmp", "/proc/self/environ", "/run", "/var"].map((path) => JSON.stringify(path)).join(", ")}]`,
        "seen = []",
        "for path in paths:",
        "    try:",
        "        if os.path.isdir(path):",
        "            os.listdir(path)",
        "            seen.append(path)",
        "        else:",
        "            open(path).read()",
        "            seen.append(path)",
        "    except OSError:",
        "        pass",
        "print('contained' if not seen else 'read ' + ','.join(seen))",
      ].join("\n"),
    contained: printedOk,
  },
  {
    name: "no writes outside the work dir",
    program: () =>
      [
        "import os",
        "wrote = []",
        `for path in ['/x', '/tmp/x', '/data/x', ${JSON.stringify(SANDBOX_INPUT_PATH)}, '/usr/lib/x', '/usr/bin/python3']:`,
        "    try:",
        "        with open(path, 'a') as f:",
        "            f.write('x')",
        "        wrote.append(path)",
        "    except OSError:",
        "        pass",
        `open(${JSON.stringify(`${SANDBOX_WORK_DIR}/ok`)}, 'w').write('ok')`,
        "print('contained' if not wrote else 'wrote ' + ','.join(wrote))",
      ].join("\n"),
    contained: printedOk,
  },
  {
    name: "empty environment",
    program: () =>
      "import os\nprint('contained' if len(os.environ) == 0 else 'env ' + ','.join(sorted(os.environ)))",
    contained: printedOk,
  },
  {
    name: "no new namespaces",
    program: () =>
      [
        "import os",
        "escaped = []",
        "for flag in ['CLONE_NEWUSER', 'CLONE_NEWNET', 'CLONE_NEWNS']:",
        "    try:",
        "        os.unshare(getattr(os, flag))",
        "        escaped.append(flag)",
        "    except (OSError, AttributeError):",
        "        pass",
        "print('contained' if not escaped else 'unshared ' + ','.join(escaped))",
      ].join("\n"),
    contained: printedOk,
  },
  {
    name: "infinite loop killed",
    program: () => "while True:\n    pass",
    contained: (result, limits) =>
      result.exitCode !== 0 && result.ms < limits.wallMs + 5_000,
  },
  {
    name: "fork bomb contained",
    program: () =>
      [
        "import os",
        "while True:",
        "    try:",
        "        os.fork()",
        "    except OSError:",
        "        pass",
      ].join("\n"),
    contained: (result, limits) =>
      result.exitCode !== 0 && result.ms < limits.wallMs + 5_000,
  },
  {
    name: "memory capped",
    program: () =>
      "blocks = []\nwhile True:\n    blocks.append(bytearray(16 * 1024 * 1024))",
    contained: (result, limits) =>
      result.exitCode !== 0 && result.ms < limits.wallMs + 5_000,
  },
  {
    name: "huge output capped",
    program: () => "import sys\nwhile True:\n    sys.stdout.write('x' * 65536)",
    contained: (result, limits) =>
      result.exitCode !== 0 &&
      result.outputCapped &&
      result.stdout.length <= limits.stdoutChars &&
      result.ms < limits.wallMs + 5_000,
  },
  {
    name: "huge file capped",
    program: () =>
      [
        `f = open(${JSON.stringify(`${SANDBOX_WORK_DIR}/big`)}, 'wb')`,
        "while True:",
        "    f.write(b'x' * 1048576)",
      ].join("\n"),
    contained: (result, limits) =>
      result.exitCode !== 0 && result.ms < limits.wallMs + 5_000,
  },
];

/** The input the probes read. */
export const PROBE_INPUT = '{"probe": 1}\n';

/** Short limits for the probes, so a check of all of them takes seconds. */
export const PROBE_LIMITS: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, wallMs: 3_000 };

export type ProbeOutcome = Readonly<{
  name: string;
  contained: boolean;
  /** How the run ended, for the log; never host text. */
  ended: string;
}>;

export const probeOutcome = (
  probe: SandboxProbe,
  result: SandboxResult,
  limits: SandboxLimits,
): ProbeOutcome => ({
  name: probe.name,
  contained: probe.contained(result, limits),
  ended: result.timedOut
    ? "wall clock"
    : result.outputCapped
      ? "output cap"
      : result.signal !== null
        ? `signal ${result.signal}`
        : `exit ${String(result.exitCode)}`,
});

/** A sandbox ready to run programs over one input file. */
export type CodeSandbox = Readonly<{
  /** What meta.json records: interpreter, bubblewrap version, limits. */
  info: SandboxInfo;
  /** Runs every probe; the run starts only when all are contained. */
  selfCheck: (host: ProbeHost) => Promise<readonly ProbeOutcome[]>;
  /** Writes the input file and returns a runner over it; `close` removes it. */
  open: (inputJson: string) => Promise<CodeSession>;
}>;

export type CodeSession = Readonly<{
  run: (code: string) => Promise<SandboxResult>;
  close: () => Promise<void>;
}>;

export type SandboxInfo = Readonly<{
  language: "python";
  interpreter: string;
  sandbox: string;
  limits: SandboxLimits;
}>;
