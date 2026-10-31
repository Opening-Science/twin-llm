import "server-only";

import { homedir } from "node:os";

import { database } from "./database";
import { storageEnv } from "./env";
import {
  SERVER_FACTS_SQL,
  type ServerFacts,
  serverFactsFromRow,
  type StorageFinding,
} from "./storage-hardening";
import { ensureOwnerDir, ownUid, statFacts, walkFacts } from "./storage-ports";
import { bootStorageCheck, ENV_FILES, scanStorage } from "./storage-scan";

/**
 * The server's side of the owner-only storage check (#144): the umask, the
 * startup check called from `instrumentation.ts`, and the findings the Lab
 * card shows. The rules are in `storage-hardening.ts`.
 */

/** New files are owner-only (0600, folders 0700) from here on. */
export const OWNER_ONLY_UMASK = 0o077;

export const restrictUmask = (): void => {
  process.umask(OWNER_ONLY_UMASK);
};

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

/** The app role's facts over the app's own pool; null (and the error name logged) on failure. */
const queryServerFacts = async (): Promise<ServerFacts | null> => {
  try {
    const rows =
      await database().$queryRawUnsafe<Readonly<Record<string, unknown>>[]>(
        SERVER_FACTS_SQL,
      );
    return serverFactsFromRow(rows[0]);
  } catch (error) {
    console.error("[storage] database facts could not be read", errorName(error));
    return null;
  }
};

/** Every finding the server can make itself; `logging` adds the statement-log settings. */
export const serverStorageFindings = (
  options: Readonly<{ logging: boolean }>,
): Promise<readonly StorageFinding[]> => {
  const env = storageEnv();
  return scanStorage(
    {
      cwd: process.cwd(),
      home: homedir(),
      ownUid: ownUid(),
      stateDir: env.stateDir,
      vitronicDir: env.vitronicDir,
      databaseUrl: env.databaseUrl,
      envFiles: ENV_FILES,
      logging: options.logging,
    },
    { stat: statFacts, walk: walkFacts, serverFacts: queryServerFacts },
  );
};

/**
 * Personal mode: refuses to start unless storage is owner-only. Synthetic
 * mode: one warning line. Never prints a secret or a path under the home
 * folder.
 */
export const checkStorageAtStartup = (): Promise<void> => {
  const env = storageEnv();
  return bootStorageCheck({
    dataMode: env.dataMode,
    ensureStateDir: () => ensureOwnerDir(env.stateDir),
    scan: () => serverStorageFindings({ logging: false }),
    warn: (line) => console.warn(line),
  });
};
