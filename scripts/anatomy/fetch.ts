/**
 * Host CLI: download the pinned reference-anatomy atlases, synthetic demo bodies
 * and their rigged variants.
 *
 * Usage (from repo root):
 *   bun run anatomy:fetch                         # everything
 *   bun run anatomy:fetch --atlas hra-f           # one atlas
 *   bun run anatomy:fetch --demo anny-adult-f     # one synthetic demo body
 *   bun run anatomy:fetch --rigged anny-adult-f   # one rigged demo body
 *   bun run anatomy:fetch --skip-rigged           # everything but the rigged bodies
 *   bun run anatomy:fetch --check                 # report, download nothing
 *
 * Each file is read with a size cap, checked against its pinned SHA-256, and
 * only then written (to a .partial file, renamed into place). A mismatch writes
 * nothing. Files land in ANATOMY_DATA_DIR (default data/anatomy, gitignored).
 * Atlases and demo bodies come from fixed URLs and must not redirect. The
 * rigged bodies are assets of this repository's anatomy-rigged-v1 release,
 * which GitHub serves through a redirect; only redirects to GitHub's own hosts
 * are followed. When a rigged body cannot be downloaded, `bun run
 * anatomy:bake-rigged` bakes it locally (needs uv).
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
import {
  RIGGED_ATTRIBUTION,
  RIGGED_BODIES,
  RIGGED_RELEASE_HOSTS,
  RIGGED_RELEASE_TAG,
  type RiggedBodyEntry,
} from "../../packages/anatomy/rigged-bodies";
import {
  type FetchFn,
  fetchPinned,
  readBounded,
  RedirectRefusedError,
  TooLargeError,
} from "../release/pinned-fetch";

export type FetchIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type FetchDeps = Readonly<{
  fetch: FetchFn;
  /** The file's bytes, or null when it does not exist. */
  readFile: (path: string) => Promise<Uint8Array | null>;
  writeFileAtomic: (path: string, bytes: Uint8Array) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
  sha256: (bytes: Uint8Array) => string;
  dir: string;
  atlases?: Readonly<Record<AtlasId, AtlasEntry>>;
  demoBodies?: Readonly<Record<DemoBodyId, DemoBodyEntry>>;
  riggedBodies?: Readonly<Record<DemoBodyId, RiggedBodyEntry>>;
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
  /** Hosts a redirect may lead to; none means a redirect is an error. */
  redirectHosts?: readonly string[];
  /** Added to a failed download, e.g. how to get the file another way. */
  fallback?: string;
}>;

const RIGGED_FALLBACK = `It comes from release ${RIGGED_RELEASE_TAG}; bun run anatomy:bake-rigged bakes it locally instead (needs uv).`;

const riggedPin = (entry: RiggedBodyEntry): PinnedFile => ({
  ...entry,
  attribution: RIGGED_ATTRIBUTION,
  redirectHosts: RIGGED_RELEASE_HOSTS,
  fallback: RIGGED_FALLBACK,
});

const BODYPARTS3D_NOTE =
  "BodyParts3D: DBCLS relicensed it to CC BY 4.0 on 2025-02-27; written confirmation is still pending (docs/anatomy.md).";

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

type Args = Readonly<{
  ids: readonly string[];
  demoIds: readonly string[];
  riggedIds: readonly string[];
  check: boolean;
  skipRigged: boolean;
}>;

const parseArgs = (argv: readonly string[]): Args => {
  const ids: string[] = [];
  const demoIds: string[] = [];
  const riggedIds: string[] = [];
  let check = false;
  let skipRigged = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--check") check = true;
    else if (argv[i] === "--skip-rigged") skipRigged = true;
    else if (argv[i] === "--atlas") {
      ids.push(argv[i + 1] ?? "");
      i += 1;
    } else if (argv[i] === "--demo") {
      demoIds.push(argv[i + 1] ?? "");
      i += 1;
    } else if (argv[i] === "--rigged") {
      riggedIds.push(argv[i + 1] ?? "");
      i += 1;
    }
  }
  return { ids, demoIds, riggedIds, check, skipRigged };
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

  const fallback = entry.fallback ? ` ${entry.fallback}` : "";
  let response: Response;
  try {
    response = await fetchPinned(deps.fetch, entry.url, entry.redirectHosts);
  } catch (error) {
    io.stderr.write(
      error instanceof RedirectRefusedError
        ? `Could not download ${entry.name}: redirected somewhere unexpected; nothing written.${fallback}\n`
        : `Could not download ${entry.name}.${fallback}\n`,
    );
    return "failed";
  }
  if (!response.ok) {
    io.stderr.write(
      `Could not download ${entry.name} (HTTP ${response.status}).${fallback}\n`,
    );
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
  const riggedBodies = deps.riggedBodies ?? RIGGED_BODIES;
  const { ids, demoIds, riggedIds, check, skipRigged } = parseArgs(argv);
  const unknown = ids.find((id) => !isAtlasId(id));
  if (unknown !== undefined) {
    io.stderr.write(`Unknown atlas "${unknown}". Known: ${ATLAS_IDS.join(", ")}.\n`);
    return 2;
  }
  const unknownDemo = [...demoIds, ...riggedIds].find((id) => !isDemoBodyId(id));
  if (unknownDemo !== undefined) {
    io.stderr.write(
      `Unknown demo body "${unknownDemo}". Known: ${DEMO_BODY_IDS.join(", ")}.\n`,
    );
    return 2;
  }
  // No selection means everything; naming only atlases (or only demo bodies) fetches just those.
  const everything = ids.length === 0 && demoIds.length === 0 && riggedIds.length === 0;
  const rigged = everything ? (skipRigged ? [] : DEMO_BODY_IDS) : riggedIds;
  const selected: readonly PinnedFile[] = [
    ...(everything ? ATLAS_IDS : ids.filter(isAtlasId)).map((id) => atlases[id]),
    ...(everything ? DEMO_BODY_IDS : demoIds.filter(isDemoBodyId)).map(
      (id) => demoBodies[id],
    ),
    ...rigged.filter(isDemoBodyId).map((id) => riggedPin(riggedBodies[id])),
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
