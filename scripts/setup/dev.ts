import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { constants } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { planDevProxies, portBusyLine, probeHosts, tagLine } from "./dev-proxies";

/**
 * `bun run dev`: the installed-packages check, then the OAuth redirect proxies
 * the env asks for (`dev-proxies.ts`), then `next dev -H 127.0.0.1` with any
 * extra arguments. Env comes from Bun, which loads `.env` and `.env.local` as
 * for the other scripts. A proxy that cannot start prints one line and dev
 * carries on. Ctrl-C, a stop signal or Next exiting stops every child.
 */

/** Null when `port` can be taken on `host`, else the error code. */
const listenProblem = (host: string | undefined, port: number): Promise<string | null> =>
  new Promise((done) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => done(error.code ?? "ERROR"));
    probe.listen({ host, port, exclusive: true }, () => probe.close(() => done(null)));
  });

/** A loopback this machine lacks (no IPv6) is not a conflict. */
const ABSENT: ReadonlySet<string> = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

/** The first reason `port` cannot be taken on any of `host`'s addresses, or null. */
const portProblem = async (
  host: string | undefined,
  port: number,
): Promise<string | null> => {
  for (const address of probeHosts(host)) {
    const problem = await listenProblem(address, port);
    if (problem !== null && !ABSENT.has(problem)) return problem;
  }
  return null;
};

/** Writes each line of `stream` to `out` with the child's tag. */
const pipeTagged = (
  stream: Readable | null,
  tag: string,
  out: NodeJS.WriteStream,
): void => {
  if (stream === null) return;
  createInterface({ input: stream }).on("line", (line) => {
    out.write(`${tagLine(tag, line)}\n`);
  });
};

const signalCode = (signal: NodeJS.Signals | null): number =>
  signal === null ? 1 : 128 + (constants.signals[signal] ?? 0);

const main = async (): Promise<void> => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  const check = spawnSync(process.execPath, ["scripts/setup/installed-packages.ts"], {
    cwd: root,
    stdio: "inherit",
  });
  if (check.status !== 0) process.exit(check.status ?? signalCode(check.signal));

  const plans = planDevProxies(process.env, existsSync, root);
  const proxies: ChildProcess[] = [];
  let stopping = false;

  for (const plan of plans) {
    if (plan.kind === "skip") {
      console.log(plan.message);
      continue;
    }
    const problem = await portProblem(plan.host, plan.port);
    if (problem !== null) {
      console.log(portBusyLine(plan.tag, plan.host, plan.port, problem));
      continue;
    }
    const child = spawn(process.execPath, [plan.script], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    pipeTagged(child.stdout, plan.tag, process.stdout);
    pipeTagged(child.stderr, plan.tag, process.stderr);
    child.on("exit", (code, signal) => {
      if (!stopping) {
        console.log(
          `${plan.tag} Stopped (${signal ?? `exit ${code ?? "?"}`}); dev keeps running.`,
        );
      }
    });
    proxies.push(child);
  }

  const next = spawn("next", ["dev", "-H", "127.0.0.1", ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
  });

  const running = (child: ChildProcess): boolean =>
    child.exitCode === null && child.signalCode === null;
  const stopProxies = (): void => {
    stopping = true;
    for (const child of proxies.filter(running)) child.kill("SIGTERM");
  };

  // Last resort: whatever ends this process takes the proxies with it.
  process.on("exit", stopProxies);

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      stopProxies();
      if (running(next)) next.kill(signal);
      else process.exit(signalCode(signal));
    });
  }

  next.on("error", (error) => {
    console.error(`[dev] Could not start next: ${error.message}`);
    stopProxies();
    process.exit(1);
  });
  next.on("exit", (code, signal) => {
    stopProxies();
    process.exit(code ?? signalCode(signal));
  });
};

void main();
