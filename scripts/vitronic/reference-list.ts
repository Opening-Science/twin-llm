/**
 * Host-only CLI: writes the BodyLoop reference-scan list (#614,
 * docs/vitronic-reference-scans.md) for the local user to
 * `<VITRONIC_DATA_DIR or data/vitronic>/reference-scans.csv`, the folder git
 * ignores. Identifiers only; Self is left out. Prints counts and the path,
 * never a row.
 *
 *   bun run vitronic:reference-list
 *   bun run vitronic:reference-list -- --user <clerk id>
 *   bun run vitronic:reference-list -- --check
 *
 * `--check` also looks for every listed mesh on disk and exits 1, naming the
 * references only, when one is missing.
 */
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ReferenceRow } from "../../features/vitronic/reference-list";

export const REFERENCE_FILE = "reference-scans.csv";

export type ReferenceListIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type ReferenceListDeps = Readonly<{
  /** The vitronic data folder (storageEnv().vitronicDir). */
  vitronicDir: () => string;
  /** LOCAL_USER_ID, the local actor. */
  localActor: () => string;
  findAppUserId: (clerkId: string) => Promise<string | null>;
  listReferenceScans: (params: {
    readonly userId: string;
    readonly actor: string;
  }) => Promise<readonly ReferenceRow[]>;
  referenceCsv: (rows: readonly ReferenceRow[]) => string;
  writeFile: (path: string, text: string) => Promise<void>;
  missingMeshes: (
    rows: readonly ReferenceRow[],
    userDir: string,
    exists: (path: string) => Promise<boolean>,
  ) => Promise<readonly string[]>;
  exists: (path: string) => Promise<boolean>;
}>;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

export const runReferenceList = async (
  argv: readonly string[],
  io: ReferenceListIo,
  deps: ReferenceListDeps,
): Promise<number> => {
  const actor = flag(argv, "--user") ?? deps.localActor();
  const userId = await deps.findAppUserId(actor);
  if (userId === null) {
    io.stderr.write("No such user on this machine; nothing written.\n");
    return 1;
  }
  const rows = await deps.listReferenceScans({ userId, actor });
  const path = join(deps.vitronicDir(), REFERENCE_FILE);
  await deps.writeFile(path, deps.referenceCsv(rows));
  const subjects = rows.filter((row) => row.repeat === 1).length;
  const incomplete = rows.filter((row) => !row.complete).length;
  io.stdout.write(
    `Reference list: ${rows.length} scans of ${subjects} subjects, ${incomplete} incomplete, written to ${path}\n`,
  );
  if (!argv.includes("--check")) return 0;
  const withMesh = rows.filter((row) => row.glbSha256).length;
  const missing = await deps.missingMeshes(
    rows,
    join(deps.vitronicDir(), userId),
    deps.exists,
  );
  if (missing.length === 0) {
    io.stdout.write(`Meshes: all ${withMesh} found\n`);
    return 0;
  }
  io.stderr.write(
    `Meshes: ${missing.length} of ${withMesh} not found: ${missing.join(", ")}\n`,
  );
  return 1;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { listReferenceScans, missingMeshes, referenceCsv } =
    await import("../../features/vitronic/reference-list");
  const { findAppUserId } = await import("../../infrastructure/current-user");
  const { serverEnv, storageEnv } = await import("../../infrastructure/env");
  const code = await runReferenceList(process.argv.slice(2), process, {
    vitronicDir: () => storageEnv().vitronicDir,
    localActor: () => serverEnv().LOCAL_USER_ID,
    findAppUserId,
    listReferenceScans,
    referenceCsv,
    writeFile: async (path, text) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, text, { mode: 0o600 });
      // mode applies only on create: a list already there keeps its old mode.
      await chmod(path, 0o600);
    },
    missingMeshes,
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
  });
  process.exit(code);
}
