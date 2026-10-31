import {
  connectionFinding,
  filesFinding,
  isInside,
  listenFinding,
  loggingFinding,
  parseDatabaseConnection,
  passwordlessFinding,
  type PathFacts,
  pathFinding,
  refusalMessage,
  roleFinding,
  type ServerFacts,
  shellWord,
  shownPath,
  socketDirFinding,
  STATE_DIR_VARIABLE,
  type StorageFinding,
  storageVerdict,
  syntheticWarning,
  type WalkedFiles,
} from "./storage-hardening";

/**
 * Runs the owner-only storage checks (#144) over injected ports, so the same
 * order and wording serve the startup check, the Lab card, `bun run doctor`
 * and `bun run lab:storage`. The ports do the I/O; this module only decides
 * which path to look at and in what order.
 */

export type WalkResult = Readonly<{ files: WalkedFiles; truncated: boolean }>;

export type StoragePorts = Readonly<{
  stat: (path: string) => Promise<PathFacts>;
  /** Every file and folder under `dir` (not `dir` itself); an empty list when `dir` is missing. */
  walk: (dir: string) => Promise<WalkResult>;
  /** The app role's facts over the app's own connection; null when it cannot connect. */
  serverFacts: () => Promise<ServerFacts | null>;
  /** True when the same URL with an empty password is accepted; null when not tried. */
  passwordless?: () => Promise<boolean | null>;
}>;

export type StorageScanInput = Readonly<{
  cwd: string;
  home: string;
  ownUid: number;
  stateDir: string;
  /** Absolute; `data/vitronic` under the repository when VITRONIC_DATA_DIR is unset. */
  vitronicDir: string;
  databaseUrl: string;
  /** Env files the app loads that exist or must be checked, relative to `cwd`. */
  envFiles: readonly string[];
  /** Statement logging (doctor and Lab; not at startup). */
  logging: boolean;
}>;

/** The env files Next.js and the scripts load; `.env.local` holds the database password. */
export const ENV_FILES = [".env.local", ".env"] as const;

const join = (dir: string, name: string): string => `${dir.replace(/\/+$/, "")}/${name}`;

const shownVitronic = (input: StorageScanInput): string =>
  isInside(input.cwd, input.vitronicDir)
    ? shownPath(input.vitronicDir, input)
    : "$VITRONIC_DATA_DIR";

export const scanStorage = async (
  input: StorageScanInput,
  ports: StoragePorts,
): Promise<readonly StorageFinding[]> => {
  const where = { cwd: input.cwd, home: input.home };
  const stateShown = shownPath(input.stateDir, where);
  const connection = parseDatabaseConnection(input.databaseUrl);
  const vitronicShown = shownPath(input.vitronicDir, where);

  const [stateFacts, envFacts, vitronicFacts, walked, socketFacts, facts, passwordless] =
    await Promise.all([
      ports.stat(input.stateDir),
      Promise.all(input.envFiles.map((name) => ports.stat(join(input.cwd, name)))),
      ports.stat(input.vitronicDir),
      ports.walk(input.vitronicDir),
      connection.kind === "socket" ? ports.stat(connection.socketDir) : null,
      ports.serverFacts(),
      ports.passwordless === undefined ? undefined : ports.passwordless(),
    ]);

  const envFindings = input.envFiles.flatMap((name, index) => {
    const facts = envFacts[index] ?? { kind: "missing" as const };
    // `.env` is optional; `.env.local` is reported even when absent.
    if (facts.kind === "missing" && name !== ".env.local") return [];
    return [
      pathFinding({
        id: `env-file:${name}`,
        subject: name,
        shown: name,
        facts,
        ownUid: input.ownUid,
        kind: "file",
        whenMissing: {
          status: "ok",
          found: "not present (settings come from the shell)",
          fix: null,
        },
      }),
    ];
  });

  return [
    pathFinding({
      id: "state-dir",
      subject: `$${STATE_DIR_VARIABLE}`,
      shown: stateShown,
      facts: stateFacts,
      ownUid: input.ownUid,
      kind: "directory",
      whenMissing: {
        status: "not-ok",
        found: "not created yet",
        fix: `mkdir -p -m 700 ${shellWord(stateShown)}`,
      },
    }),
    ...envFindings,
    pathFinding({
      id: "vitronic-dir",
      subject: shownVitronic(input),
      shown: vitronicShown,
      facts: vitronicFacts,
      ownUid: input.ownUid,
      kind: "directory",
      whenMissing: {
        status: "ok",
        found: "not created yet (the app creates it owner-only)",
        fix: null,
      },
    }),
    filesFinding({
      id: "vitronic-files",
      subject: `Files in ${shownVitronic(input)}`,
      shown: vitronicShown,
      files: walked.files,
      truncated: walked.truncated,
      ownUid: input.ownUid,
    }),
    connectionFinding(connection, { stateDir: input.stateDir, stateShown }),
    ...(connection.kind === "socket" && socketFacts !== null
      ? [
          socketDirFinding({
            shown: shownPath(connection.socketDir, where),
            facts: socketFacts,
            ownUid: input.ownUid,
          }),
        ]
      : []),
    roleFinding(facts),
    listenFinding(connection, facts),
    ...(input.logging ? [loggingFinding(facts)] : []),
    ...(passwordless === undefined ? [] : [passwordlessFinding(passwordless)]),
  ];
};

/** Thrown at startup in personal mode; its message is the whole plain explanation. */
export class StorageNotOwnerOnlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageNotOwnerOnlyError";
  }
}

export type StorageBootDeps = Readonly<{
  dataMode: "personal" | "synthetic";
  /** Creates the state directory (mode 0700) when it is missing. Personal mode only. */
  ensureStateDir: () => Promise<void>;
  scan: () => Promise<readonly StorageFinding[]>;
  warn: (line: string) => void;
}>;

/**
 * The startup step: personal mode refuses to start (throws with the plain
 * message) when anything is not owner-only or could not be checked;
 * synthetic mode logs one warning line and goes on.
 */
export const bootStorageCheck = async (deps: StorageBootDeps): Promise<void> => {
  // A folder that cannot be created shows up below as missing or unreadable.
  if (deps.dataMode === "personal") await deps.ensureStateDir().catch(() => undefined);
  const findings = await deps.scan();
  const verdict = storageVerdict(deps.dataMode, findings);
  if (verdict.refuse)
    throw new StorageNotOwnerOnlyError(refusalMessage(verdict.problems));
  if (verdict.problems.length > 0) deps.warn(syntheticWarning(verdict.problems));
};
