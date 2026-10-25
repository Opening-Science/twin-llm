/**
 * Host CLI: download the pinned reference-anatomy atlases and synthetic demo bodies.
 *
 * Usage (from repo root):
 *   bun run anatomy:fetch                       # all atlases and demo bodies
 *   bun run anatomy:fetch --atlas hra-f         # one atlas
 *   bun run anatomy:fetch --demo anny-adult-f   # one synthetic demo body
 *   bun run anatomy:fetch --check               # report, download nothing
 *
 * Each file is read with a size cap, checked against its pinned SHA-256, and
 * only then written (to a .partial file, renamed into place). A mismatch writes
 * nothing. Files land in ANATOMY_DATA_DIR (default data/anatomy, gitignored).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEMO_BODIES,
  DEMO_BODY_IDS,
  isDemoBodyId,
  type DemoBodyEntry,
  type DemoBodyId,
} from "../../packages/anatomy/demo-bodies";
import {
  ATLAS_IDS,
  ATLASES,
  isAtlasId,
  type AtlasEntry,
  type AtlasId,
} from "../../packages/anatomy/manifest";
import { resolveAnatomyDir } from "../../packages/anatomy/paths";

export type FetchIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type FetchDeps = Readonly<{
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The file's bytes, or null when it does not exist. */
  readFile: (path: string) => Promise<Uint8Array | null>;
  writeFileAtomic: (path: string, bytes: Uint8Array) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
  sha256: (bytes: Uint8Array) => string;
  dir: string;
  atlases?: Readonly<Record<AtlasId, AtlasEntry>>;
  demoBodies?: Readonly<Record<DemoBodyId, DemoBodyEntry>>;
}>;

/** What fetching needs from an atlas or a demo body pin. */
type PinnedFile = Readonly<{
  id: string;
  name: string;
  url: string;
  fileName: string;
  bytes: number;
  sha256: string;
  attribution: string;
}>;

const BODYPARTS3D_NOTE =
  "BodyParts3D: DBCLS relicensed it to CC BY 4.0 on 2025-02-27; written confirmation is still pending (docs/anatomy.md).";

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

class TooLargeError extends Error {}

/** Reads at most `max` bytes; throws TooLargeError past that. */
const readBounded = async (response: Response, max: number): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new TooLargeError();
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.byteLength > max) throw new TooLargeError();
    return whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new TooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

const parseArgs = (
  argv: readonly string[],
): Readonly<{ ids: readonly string[]; demoIds: readonly string[]; check: boolean }> => {
  const ids: string[] = [];
  const demoIds: string[] = [];
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--check") check = true;
    else if (argv[i] === "--atlas") {
      ids.push(argv[i + 1] ?? "");
      i += 1;
    } else if (argv[i] === "--demo") {
      demoIds.push(argv[i + 1] ?? "");
      i += 1;
    }
  }
  return { ids, demoIds, check };
};

type Outcome = "installed" | "present" | "missing" | "failed";

const fetchOne = async (
  entry: PinnedFile,
  check: boolean,
  io: FetchIo,
  deps: FetchDeps,
): Promise<Outcome> => {
  const path = join(deps.dir, entry.fileName);
  const existing = await deps.readFile(path);
  if (existing && deps.sha256(existing) === entry.sha256) {
    io.stdout.write(`${entry.name}: already installed.\n`);
    return "present";
  }
  if (check) {
    io.stdout.write(`${entry.name}: not installed.\n`);
    return "missing";
  }

  let response: Response;
  try {
    response = await deps.fetch(entry.url, { redirect: "error" });
  } catch {
    io.stderr.write(`Could not download ${entry.name}.\n`);
    return "failed";
  }
  if (!response.ok) {
    io.stderr.write(`Could not download ${entry.name} (HTTP ${response.status}).\n`);
    return "failed";
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBounded(response, entry.bytes);
  } catch (error) {
    io.stderr.write(
      error instanceof TooLargeError
        ? `${entry.name} is larger than its pin; nothing written.\n`
        : `Could not download ${entry.name}.\n`,
    );
    return "failed";
  }
  if (bytes.byteLength !== entry.bytes || deps.sha256(bytes) !== entry.sha256) {
    io.stderr.write(`Checksum mismatch for ${entry.name}; nothing written.\n`);
    return "failed";
  }

  try {
    await deps.mkdir(deps.dir);
    await deps.writeFileAtomic(path, bytes);
  } catch {
    io.stderr.write(`Could not write ${entry.name} to ${deps.dir}.\n`);
    return "failed";
  }
  io.stdout.write(`${entry.name}: installed (${megabytes(bytes.byteLength)}).\n`);
  return "installed";
};

export const runAnatomyFetch = async (
  argv: readonly string[],
  io: FetchIo,
  deps: FetchDeps,
): Promise<number> => {
  const atlases = deps.atlases ?? ATLASES;
  const demoBodies = deps.demoBodies ?? DEMO_BODIES;
  const { ids, demoIds, check } = parseArgs(argv);
  const unknown = ids.find((id) => !isAtlasId(id));
  if (unknown !== undefined) {
    io.stderr.write(`Unknown atlas "${unknown}". Known: ${ATLAS_IDS.join(", ")}.\n`);
    return 2;
  }
  const unknownDemo = demoIds.find((id) => !isDemoBodyId(id));
  if (unknownDemo !== undefined) {
    io.stderr.write(
      `Unknown demo body "${unknownDemo}". Known: ${DEMO_BODY_IDS.join(", ")}.\n`,
    );
    return 2;
  }
  // No selection means everything; naming only atlases (or only demo bodies) fetches just those.
  const everything = ids.length === 0 && demoIds.length === 0;
  const selected: readonly PinnedFile[] = [
    ...(everything ? ATLAS_IDS : ids.filter(isAtlasId)).map((id) => atlases[id]),
    ...(everything ? DEMO_BODY_IDS : demoIds.filter(isDemoBodyId)).map(
      (id) => demoBodies[id],
    ),
  ];

  const outcomes: Outcome[] = [];
  for (const entry of selected) {
    outcomes.push(await fetchOne(entry, check, io, deps));
  }

  const ready = selected.filter(
    (_, i) => outcomes[i] === "installed" || outcomes[i] === "present",
  );
  if (ready.length > 0) {
    io.stdout.write("\nCredit wherever these models are shown:\n");
    for (const attribution of new Set(ready.map((entry) => entry.attribution))) {
      io.stdout.write(`  ${attribution}\n`);
    }
    if (ready.some((entry) => entry.id === "bodyparts3d")) {
      io.stdout.write(`${BODYPARTS3D_NOTE}\n`);
    }
  }

  return outcomes.some((outcome) => outcome === "failed" || outcome === "missing")
    ? 1
    : 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const code = await runAnatomyFetch(process.argv.slice(2), process, {
    fetch: (url, init) => fetch(url, init),
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
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    dir: resolveAnatomyDir(process.env.ANATOMY_DATA_DIR, root),
  });
  process.exit(code);
}
