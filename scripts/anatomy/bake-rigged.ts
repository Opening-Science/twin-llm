/**
 * Host CLI: bake the rigged ANNY demo bodies and install them when they match their pins.
 *
 * Usage (from repo root; needs uv, https://docs.astral.sh/uv/):
 *   bun run anatomy:bake-rigged                       # both bodies
 *   bun run anatomy:bake-rigged --demo anny-adult-f   # one body
 *   bun run anatomy:bake-rigged --check               # report, bake nothing
 *
 * The fallback for `bun run anatomy:fetch`, which downloads the same pinned
 * files from the anatomy-rigged-v1 release. The bake is
 * `scripts/anatomy/bake-anny-rigged.py`, run by `uv run --script` against its
 * lockfile (anny 0.6.2, torch 2.14.1: the CPU build on Linux and Windows, PyPI's
 * on macOS). It writes to a scratch file; this script checks the bytes against
 * the pin in packages/anatomy/rigged-bodies.ts and only then installs them
 * (`.partial`, then rename) next to the atlases. A mismatch writes nothing and
 * prints the SHA-256 it got, so a pin bump is a deliberate edit. It also says
 * whether the body's content matches (`contentSha256`, see
 * rigged-content-digest.ts): on a machine whose float maths differs from the
 * Linux x86_64 bake in the last bits, the bytes can differ while the body is
 * the same, and the download is then the way to the pinned file.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEMO_BODIES,
  DEMO_BODY_IDS,
  isDemoBodyId,
  type DemoBodyId,
} from "../../packages/anatomy/demo-bodies";
import { resolveAnatomyDir } from "../../packages/anatomy/paths";
import {
  RIGGED_ATTRIBUTION,
  RIGGED_BODIES,
  type RiggedBodyEntry,
} from "../../packages/anatomy/rigged-bodies";
import { riggedCanonicalContent } from "./rigged-content-digest";

export const BAKE_SCRIPT = join("scripts", "anatomy", "bake-anny-rigged.py");

export type BakeIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type BakeDeps = Readonly<{
  /** Runs the Python bake for one body into `out`; resolves to the exit code, null when uv is missing. */
  bake: (sex: RiggedBodyEntry["sex"], out: string) => Promise<number | null>;
  /** The file's bytes, or null when it does not exist. */
  readFile: (path: string) => Promise<Uint8Array | null>;
  writeFileAtomic: (path: string, bytes: Uint8Array) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
  /** A fresh scratch path for one bake's output. */
  scratchFile: (name: string) => Promise<string>;
  sha256: (bytes: Uint8Array) => string;
  dir: string;
  rigged?: Readonly<Record<DemoBodyId, RiggedBodyEntry>>;
}>;

type Outcome = "installed" | "present" | "missing" | "failed";

const parseArgs = (
  argv: readonly string[],
): Readonly<{ ids: readonly string[]; check: boolean }> => {
  const ids: string[] = [];
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--check") check = true;
    else if (argv[i] === "--demo") {
      ids.push(argv[i + 1] ?? "");
      i += 1;
    }
  }
  return { ids, check };
};

const bakeOne = async (
  entry: RiggedBodyEntry,
  check: boolean,
  io: BakeIo,
  deps: BakeDeps,
): Promise<Outcome> => {
  const name = `${DEMO_BODIES[entry.id].name}, rigged`;
  const path = join(deps.dir, entry.fileName);
  const existing = await deps.readFile(path);
  if (existing && deps.sha256(existing) === entry.sha256) {
    io.stdout.write(`${name}: already installed.\n`);
    return "present";
  }
  if (check) {
    io.stdout.write(`${name}: not installed.\n`);
    return "missing";
  }

  const out = await deps.scratchFile(entry.fileName);
  const code = await deps.bake(entry.sex, out);
  if (code === null) {
    io.stderr.write(`Baking ${name} needs uv (https://docs.astral.sh/uv/).\n`);
    return "failed";
  }
  const bytes = code === 0 ? await deps.readFile(out) : null;
  if (!bytes) {
    io.stderr.write(`Could not bake ${name} (exit ${code}).\n`);
    return "failed";
  }
  const got = deps.sha256(bytes);
  if (bytes.byteLength !== entry.bytes || got !== entry.sha256) {
    const content = riggedCanonicalContent(bytes);
    const contentSha = content === null ? null : deps.sha256(content);
    const verdict =
      contentSha === entry.contentSha256
        ? "Its content matches the pin (content SHA-256 as pinned): the same body, with a few values encoded differently by this machine's float maths."
        : `Its content differs from the pin too (content SHA-256 ${contentSha ?? "unreadable"}).`;
    io.stderr.write(
      `${name}: the bake gave ${bytes.byteLength} bytes, SHA-256 ${got}, which is not the pin; nothing written. ${verdict} bun run anatomy:fetch downloads the pinned file.\n`,
    );
    return "failed";
  }
  try {
    await deps.mkdir(deps.dir);
    await deps.writeFileAtomic(path, bytes);
  } catch {
    io.stderr.write(`Could not write ${name} to ${deps.dir}.\n`);
    return "failed";
  }
  io.stdout.write(`${name}: installed (${entry.joints} joints).\n`);
  return "installed";
};

export const runBakeRigged = async (
  argv: readonly string[],
  io: BakeIo,
  deps: BakeDeps,
): Promise<number> => {
  const rigged = deps.rigged ?? RIGGED_BODIES;
  const { ids, check } = parseArgs(argv);
  const unknown = ids.find((id) => !isDemoBodyId(id));
  if (unknown !== undefined) {
    io.stderr.write(
      `Unknown demo body "${unknown}". Known: ${DEMO_BODY_IDS.join(", ")}.\n`,
    );
    return 2;
  }
  const selected = (ids.length === 0 ? DEMO_BODY_IDS : ids.filter(isDemoBodyId)).map(
    (id) => rigged[id],
  );
  const outcomes: Outcome[] = [];
  for (const entry of selected) {
    outcomes.push(await bakeOne(entry, check, io, deps));
  }
  if (outcomes.some((outcome) => outcome === "installed" || outcome === "present")) {
    io.stdout.write(
      `\nCredit wherever these models are shown:\n  ${RIGGED_ATTRIBUTION}\n`,
    );
  }
  return outcomes.some((outcome) => outcome === "failed" || outcome === "missing")
    ? 1
    : 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const scratch = await mkdtemp(join(tmpdir(), "twin-llm-bake-"));
  const code = await runBakeRigged(process.argv.slice(2), process, {
    bake: async (sex, out) => {
      const run = spawnSync("uv", ["run", "--quiet", "--script", BAKE_SCRIPT, sex, out], {
        cwd: root,
        stdio: ["ignore", "ignore", "inherit"],
      });
      if (run.error) return null;
      return run.status ?? 1;
    },
    readFile: async (path) => {
      try {
        return new Uint8Array(await readFile(path));
      } catch {
        return null;
      }
    },
    writeFileAtomic: async (path, bytes) => {
      const partial = `${path}.partial`;
      try {
        await writeFile(partial, bytes);
        await rename(partial, path);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
    },
    mkdir: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    scratchFile: async (name) => join(scratch, name),
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    dir: resolveAnatomyDir(process.env.ANATOMY_DATA_DIR, root),
  });
  await rm(scratch, { recursive: true, force: true });
  process.exit(code);
}
