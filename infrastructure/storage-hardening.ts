/**
 * Whether TwinLLM's storage is open only to the owner's OS user (#144,
 * docs/privacy-design.md section 2.1). Pure: every fact about the machine
 * (file modes, the database role) comes in as data, so each rule is tested
 * with tables. The startup check, `bun run doctor`, `bun run lab:storage` and
 * the Lab's "Local storage" card all read these findings.
 *
 * Nothing here returns a password, a full URL or a path under the home
 * folder: a finding names its subject (`.env.local`, `$TWINLLM_STATE_DIR`),
 * a mode, and a fix that can be pasted into a shell.
 */

export type StoragePlatform = "linux" | "darwin";

/** The variable that names the state directory, as shown on cards and in messages. */
export const STATE_DIR_VARIABLE = "TWINLLM_STATE_DIR";

/** The command that creates the recommended owner-only Postgres cluster. */
export const OWNER_CLUSTER_COMMAND = "bun run setup:local -- --owner-cluster";

/** Repeats every check by hand and prints names and modes only. */
export const STORAGE_CHECK_COMMAND = "bun run lab:storage";

/** The role the app connects as in the recommended and accepted setups. */
export const APP_ROLE = "twinllm";

/**
 * `$XDG_DATA_HOME/twin-llm` (falling back to `~/.local/share/twin-llm`) on
 * Linux, `~/Library/Application Support/TwinLLM` on macOS.
 */
export const defaultStateDir = (
  input: Readonly<{
    platform: StoragePlatform;
    home: string;
    xdgDataHome?: string | undefined;
  }>,
): string => {
  const home = input.home.replace(/\/+$/, "");
  if (input.platform === "darwin") return `${home}/Library/Application Support/TwinLLM`;
  const xdg = input.xdgDataHome?.trim();
  // The XDG spec ignores a relative XDG_DATA_HOME.
  const base =
    xdg && xdg.startsWith("/") ? xdg.replace(/\/+$/, "") : `${home}/.local/share`;
  return `${base}/twin-llm`;
};

// ---------------------------------------------------------------------------
// Paths as shown
// ---------------------------------------------------------------------------

const trimSlashes = (path: string): string =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

/** `child` is `parent` or inside it (plain string paths, already absolute). */
export const isInside = (parent: string, child: string): boolean => {
  const p = trimSlashes(parent);
  const c = trimSlashes(child);
  return c === p || c.startsWith(p === "/" ? "/" : `${p}/`);
};

/**
 * How a path is written in a message or a command: relative to the
 * repository when inside it, `$HOME/...` when under the home folder, else as
 * it is. The home folder itself is never written out.
 */
export const shownPath = (
  path: string,
  where: Readonly<{ cwd: string; home: string }>,
): string => {
  const target = trimSlashes(path);
  const cwd = trimSlashes(where.cwd);
  if (target === cwd) return ".";
  if (isInside(cwd, target)) return target.slice(cwd.length + 1);
  const home = trimSlashes(where.home);
  if (home !== "/" && home !== "" && isInside(home, target)) {
    return target === home ? "$HOME" : `$HOME${target.slice(home.length)}`;
  }
  return target;
};

/** One shown path as a shell word; `$HOME` stays expandable. */
export const shellWord = (shown: string): string => {
  if (/^[\w./-]+$/.test(shown)) return shown;
  return `"${shown.replace(/(["\\`])/g, "\\$1").replace(/\$(?!HOME\b)/g, "\\$")}"`;
};

// ---------------------------------------------------------------------------
// File modes
// ---------------------------------------------------------------------------

/** What `stat` told us about one path. */
export type PathFacts =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "found"; mode: number; uid: number; directory: boolean }>;

/** `0o755` as `755`. */
export const modeText = (mode: number): string =>
  (mode & 0o777).toString(8).padStart(3, "0");

/** No permission bit for group or others. */
export const isOwnerOnly = (mode: number): boolean => (mode & 0o077) === 0;

export type StorageStatus = "ok" | "not-ok" | "unknown";

export type StorageFinding = Readonly<{
  id: string;
  /** What was checked, as shown: `.env.local`, `$TWINLLM_STATE_DIR`, `Database role`. */
  subject: string;
  status: StorageStatus;
  /** What was found, in a few words: `mode 755`, `socket in $TWINLLM_STATE_DIR`. */
  found: string;
  /** What owner-only means for this item. */
  expected: string;
  /** A command or a short instruction; null when nothing needs doing. */
  fix: string | null;
}>;

type PathCheck = Readonly<{
  id: string;
  subject: string;
  /** The path as written in the fix command (see `shownPath`). */
  shown: string;
  facts: PathFacts;
  ownUid: number;
  kind: "directory" | "file";
  /** A path that does not exist yet: fine (created owner-only later) or a problem. */
  whenMissing: Readonly<{ status: StorageStatus; found: string; fix: string | null }>;
}>;

/** One file or directory: owned by this user, no bits for group or others. */
export const pathFinding = (check: PathCheck): StorageFinding => {
  const wanted = check.kind === "directory" ? "700" : "600";
  const base = {
    id: check.id,
    subject: check.subject,
    expected: `mode ${wanted} or narrower, owned by you`,
  };
  const { facts } = check;
  if (facts.kind === "missing") return { ...base, ...check.whenMissing };
  if (facts.kind === "unreadable") {
    return {
      ...base,
      status: "unknown",
      found: "could not be checked",
      fix: `ls -ld ${shellWord(check.shown)}`,
    };
  }
  const isDirectory = check.kind === "directory";
  if (facts.directory !== isDirectory) {
    return {
      ...base,
      status: "not-ok",
      found: isDirectory ? "not a directory" : "a directory, not a file",
      fix: `ls -ld ${shellWord(check.shown)}`,
    };
  }
  if (facts.uid !== check.ownUid) {
    return {
      ...base,
      status: "not-ok",
      found: `mode ${modeText(facts.mode)}, owned by another user`,
      fix: `chown "$(id -u)" ${shellWord(check.shown)}`,
    };
  }
  if (!isOwnerOnly(facts.mode)) {
    return {
      ...base,
      status: "not-ok",
      found: `mode ${modeText(facts.mode)}`,
      fix: `chmod ${wanted} ${shellWord(check.shown)}`,
    };
  }
  return { ...base, status: "ok", found: `mode ${modeText(facts.mode)}`, fix: null };
};

/** Files found under a directory, each with its facts; null when the walk failed. */
export type WalkedFiles = readonly PathFacts[] | null;

/** Every file and folder under a data directory is owner-only. */
export const filesFinding = (
  input: Readonly<{
    id: string;
    subject: string;
    shown: string;
    files: WalkedFiles;
    ownUid: number;
    /** The walk stopped at its limit, so some files were not looked at. */
    truncated?: boolean;
  }>,
): StorageFinding => {
  const base = {
    id: input.id,
    subject: input.subject,
    expected: "files 600 and folders 700 or narrower, owned by you",
  };
  if (input.files === null) {
    return {
      ...base,
      status: "unknown",
      found: "could not be listed",
      fix: `ls -lR ${shellWord(input.shown)}`,
    };
  }
  const unreadable = input.files.filter((file) => file.kind === "unreadable").length;
  const found = input.files.filter(
    (file): file is Extract<PathFacts, { kind: "found" }> => file.kind === "found",
  );
  const foreign = found.filter((file) => file.uid !== input.ownUid).length;
  const wide = found.filter((file) => !isOwnerOnly(file.mode)).length;
  const entries = (n: number): string => `${n} ${n === 1 ? "entry" : "entries"}`;
  if (foreign > 0) {
    return {
      ...base,
      status: "not-ok",
      found: `${entries(foreign)} owned by another user`,
      fix: `chown -R "$(id -u)" ${shellWord(input.shown)}`,
    };
  }
  if (wide > 0) {
    return {
      ...base,
      status: "not-ok",
      found: `${entries(wide)} open to group or others`,
      fix: `chmod -R go-rwx ${shellWord(input.shown)}`,
    };
  }
  if (unreadable > 0 || input.truncated === true) {
    return {
      ...base,
      status: "unknown",
      found:
        unreadable > 0
          ? `${entries(unreadable)} could not be checked`
          : `the first ${found.length} entries are owner-only; more were not checked`,
      fix: `find ${shellWord(input.shown)} -perm /077`,
    };
  }
  return {
    ...base,
    status: "ok",
    found:
      found.length === 0 ? "no files yet" : `${entries(found.length)}, all owner-only`,
    fix: null,
  };
};

// ---------------------------------------------------------------------------
// DATABASE_URL
// ---------------------------------------------------------------------------

export type DatabaseConnection =
  | Readonly<{
      kind: "socket";
      /** The folder that holds `.s.PGSQL.<port>`. */
      socketDir: string;
      port: number;
      user: string | null;
      hasPassword: boolean;
      database: string | null;
    }>
  | Readonly<{
      kind: "tcp";
      host: string;
      port: number;
      loopback: boolean;
      user: string | null;
      hasPassword: boolean;
      database: string | null;
    }>
  | Readonly<{ kind: "invalid"; reason: string }>;

const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * `localhost`, `127.0.0.0/8` or `::1` exactly. A name that only resolves to
 * loopback (`localhost.example.com`) does not count.
 */
export const isLoopbackHost = (raw: string): boolean => {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = IPV4_LOOPBACK.exec(host);
  return ipv4 !== null && ipv4.slice(1).every((octet) => Number(octet) <= 255);
};

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const DEFAULT_PORT = 5432;

/**
 * Reads a Postgres connection string the way node-postgres does: a `host`
 * query parameter wins over the host in the URL, and a host that starts with
 * `/` (also `%2F...`) is a Unix socket folder. `user@/db?host=/dir` parses as
 * well, although Prisma's migrate needs `user@localhost/db?host=/dir`.
 * Returns facts only, never the password.
 */
export const parseDatabaseConnection = (raw: string): DatabaseConnection => {
  const text = raw.trim();
  if (!/^postgres(ql)?:\/\//i.test(text)) {
    return { kind: "invalid", reason: "not a postgres:// or postgresql:// URL" };
  }
  const parse = (value: string): URL | null =>
    URL.canParse(value) ? new URL(value) : null;
  const direct = parse(text);
  const url = direct ?? parse(text.replace("@/", "@dummy-host.invalid/"));
  if (url === null) return { kind: "invalid", reason: "DATABASE_URL could not be read" };
  const urlHost = direct === null ? "" : decode(url.hostname);
  const param = url.searchParams.get("host");
  const host = param !== null && param !== "" ? param : urlHost;
  const portText = url.searchParams.get("port") || url.port;
  const port = portText === "" ? DEFAULT_PORT : Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { kind: "invalid", reason: "DATABASE_URL has a port that is not a number" };
  }
  const user = decode(url.searchParams.get("user") ?? url.username) || null;
  const hasPassword = (url.searchParams.get("password") ?? url.password) !== "";
  const database = decode(url.pathname.replace(/^\//, "")) || null;
  if (host === "") {
    return {
      kind: "invalid",
      reason: "DATABASE_URL names no host; name 127.0.0.1 or the socket folder",
    };
  }
  if (host.includes(",")) {
    return { kind: "invalid", reason: "DATABASE_URL names more than one host" };
  }
  if (host.startsWith("/")) {
    return {
      kind: "socket",
      socketDir: trimSlashes(host),
      port,
      user,
      hasPassword,
      database,
    };
  }
  return {
    kind: "tcp",
    host,
    port,
    loopback: isLoopbackHost(host),
    user,
    hasPassword,
    database,
  };
};

const CONNECTION_EXPECTED =
  "a socket in $TWINLLM_STATE_DIR, or loopback TCP with a password";

/** Where the app connects: the socket folder or loopback, never another machine. */
export const connectionFinding = (
  connection: DatabaseConnection,
  where: Readonly<{ stateDir: string; stateShown: string }>,
): StorageFinding => {
  const base = {
    id: "database-url",
    subject: "DATABASE_URL",
    expected: CONNECTION_EXPECTED,
  };
  switch (connection.kind) {
    case "invalid":
      return {
        ...base,
        status: "not-ok",
        found: connection.reason,
        fix: OWNER_CLUSTER_COMMAND,
      };
    case "socket":
      return isInside(where.stateDir, connection.socketDir)
        ? { ...base, status: "ok", found: "socket in $TWINLLM_STATE_DIR", fix: null }
        : {
            ...base,
            status: "not-ok",
            found: "socket outside $TWINLLM_STATE_DIR",
            fix: OWNER_CLUSTER_COMMAND,
          };
    case "tcp":
      if (!connection.loopback) {
        return {
          ...base,
          status: "not-ok",
          found: "TCP to a host that is not loopback",
          fix: OWNER_CLUSTER_COMMAND,
        };
      }
      return connection.hasPassword
        ? { ...base, status: "ok", found: "loopback TCP with a password", fix: null }
        : {
            ...base,
            status: "not-ok",
            found: "loopback TCP without a password",
            fix: `give the ${APP_ROLE} role a password (docs/runbook.md, "Owner-only Postgres"), or ${OWNER_CLUSTER_COMMAND}`,
          };
  }
};

/** The socket folder itself must be owner-only, so no other user can open the socket. */
export const socketDirFinding = (
  input: Readonly<{ shown: string; facts: PathFacts; ownUid: number }>,
): StorageFinding =>
  pathFinding({
    id: "socket-dir",
    subject: "Socket folder",
    shown: input.shown,
    facts: input.facts,
    ownUid: input.ownUid,
    kind: "directory",
    whenMissing: {
      status: "not-ok",
      found: "missing",
      fix: OWNER_CLUSTER_COMMAND,
    },
  });

// ---------------------------------------------------------------------------
// What the database says about itself
// ---------------------------------------------------------------------------

/** Read from the server over the app's own connection. */
export type ServerFacts = Readonly<{
  superuser: boolean;
  /** `SHOW listen_addresses`. */
  listenAddresses: string;
  /** `SHOW log_statement`; null when not read. */
  logStatement?: string | null;
  /** `SHOW log_min_duration_statement` (`-1` is off); null when not read. */
  logMinDurationStatement?: string | null;
}>;

/** One query, readable by any role, that fills `ServerFacts`. */
export const SERVER_FACTS_SQL =
  "select r.rolsuper as superuser, current_setting('listen_addresses') as listen_addresses, current_setting('log_statement') as log_statement, current_setting('log_min_duration_statement') as log_min_duration_statement from pg_roles r where r.rolname = current_user";

/** A row of `SERVER_FACTS_SQL` as facts, or null when it has the wrong shape. */
export const serverFactsFromRow = (
  row: Readonly<Record<string, unknown>> | undefined,
): ServerFacts | null => {
  if (row === undefined) return null;
  const superuser = row.superuser;
  const listen = row.listen_addresses;
  if (typeof superuser !== "boolean" || typeof listen !== "string") return null;
  const text = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  return {
    superuser,
    listenAddresses: listen,
    logStatement: text(row.log_statement),
    logMinDurationStatement: text(row.log_min_duration_statement),
  };
};

const listenEntries = (value: string): readonly string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

/** The app's role is not a superuser, so it cannot read files or run programs as Postgres. */
export const roleFinding = (facts: ServerFacts | null): StorageFinding => {
  const base = {
    id: "database-role",
    subject: "Database role",
    expected: "not a superuser",
  };
  if (facts === null) {
    return {
      ...base,
      status: "unknown",
      found: "could not be read",
      fix: "check that Postgres is running, then bun run doctor",
    };
  }
  return facts.superuser
    ? {
        ...base,
        status: "not-ok",
        found: "superuser",
        fix: `connect as a role that is not a superuser: ${OWNER_CLUSTER_COMMAND}`,
      }
    : { ...base, status: "ok", found: "not a superuser", fix: null };
};

/**
 * With a socket in the state folder Postgres needs no TCP port at all; with
 * TCP it listens on loopback only.
 */
export const listenFinding = (
  connection: DatabaseConnection,
  facts: ServerFacts | null,
): StorageFinding => {
  const socket = connection.kind === "socket";
  const base = {
    id: "listen-addresses",
    subject: "Postgres listens on",
    expected: socket ? "no TCP address" : "loopback addresses only",
  };
  if (facts === null) {
    return {
      ...base,
      status: "unknown",
      found: "could not be read",
      fix: "check that Postgres is running, then bun run doctor",
    };
  }
  const entries = listenEntries(facts.listenAddresses);
  if (entries.length === 0) {
    return { ...base, status: "ok", found: "no TCP address", fix: null };
  }
  const elsewhere = entries.filter((entry) => !isLoopbackHost(entry));
  if (elsewhere.length > 0) {
    return {
      ...base,
      status: "not-ok",
      found: "an address other machines can reach",
      fix: `set listen_addresses = 'localhost' in postgresql.conf and restart Postgres, or ${OWNER_CLUSTER_COMMAND}`,
    };
  }
  return socket
    ? {
        ...base,
        status: "not-ok",
        found: "loopback TCP as well as the socket",
        fix: "set listen_addresses = '' in the cluster's postgresql.conf and restart it",
      }
    : { ...base, status: "ok", found: "loopback only", fix: null };
};

/** Statement logging would write personal values into the Postgres log. */
export const loggingFinding = (facts: ServerFacts | null): StorageFinding => {
  const base = {
    id: "statement-logging",
    subject: "Statement logging",
    expected: "log_statement none or ddl, log_min_duration_statement off",
  };
  if (
    facts === null ||
    facts.logStatement == null ||
    facts.logMinDurationStatement == null
  ) {
    return {
      ...base,
      status: "unknown",
      found: "could not be read",
      fix: "check that Postgres is running, then bun run doctor",
    };
  }
  const statementOk = facts.logStatement === "none" || facts.logStatement === "ddl";
  const durationOk = facts.logMinDurationStatement.trim() === "-1";
  if (statementOk && durationOk) {
    return { ...base, status: "ok", found: "off", fix: null };
  }
  return {
    ...base,
    status: "not-ok",
    found: [
      statementOk ? null : `log_statement ${facts.logStatement}`,
      durationOk ? null : "log_min_duration_statement on",
    ]
      .filter((part) => part !== null)
      .join(", "),
    fix: "set log_statement = 'none' and log_min_duration_statement = -1 in postgresql.conf, then reload Postgres",
  };
};

/**
 * A connection with the same URL and an empty password must be refused; if
 * it is accepted, `trust` lets any local user in. `null`: not tried.
 */
export const passwordlessFinding = (
  acceptedWithoutPassword: boolean | null,
): StorageFinding => {
  const base = {
    id: "passwordless",
    subject: "Sign-in without a password",
    expected: "refused",
  };
  if (acceptedWithoutPassword === null) {
    return {
      ...base,
      status: "unknown",
      found: "not tried",
      fix: "bun run doctor",
    };
  }
  return acceptedWithoutPassword
    ? {
        ...base,
        status: "not-ok",
        found: "accepted (trust)",
        fix: `replace trust with scram-sha-256 in pg_hba.conf and reload Postgres, or ${OWNER_CLUSTER_COMMAND}`,
      }
    : { ...base, status: "ok", found: "refused", fix: null };
};

// ---------------------------------------------------------------------------
// Verdict and messages
// ---------------------------------------------------------------------------

export type StorageVerdict = Readonly<{
  /** Personal mode with anything not OK, including a check that could not run. */
  refuse: boolean;
  problems: readonly StorageFinding[];
}>;

/** Fail closed in personal mode; synthetic mode only warns. */
export const storageVerdict = (
  dataMode: "personal" | "synthetic",
  findings: readonly StorageFinding[],
): StorageVerdict => {
  const problems = findings.filter((finding) => finding.status !== "ok");
  return { refuse: dataMode === "personal" && problems.length > 0, problems };
};

const problemLine = (finding: StorageFinding): string =>
  `  - ${finding.subject}: ${finding.found}; needs ${finding.expected}.${finding.fix === null ? "" : ` Fix: ${finding.fix}`}`;

/** The startup refusal: plain, with the commands that fix it, no secret and no home path. */
export const refusalMessage = (problems: readonly StorageFinding[]): string =>
  [
    "TwinLLM did not start: DATA_MODE=personal needs storage that only your OS user can open.",
    ...problems.map(problemLine),
    `Run ${STORAGE_CHECK_COMMAND} to repeat these checks. Why: docs/privacy-design.md, section 2.1.`,
  ].join("\n");

/** The synthetic-mode warning at startup: one line, pointing at the full list. */
export const syntheticWarning = (problems: readonly StorageFinding[]): string =>
  `[storage] ${problems.length} storage check${problems.length === 1 ? " is" : "s are"} not owner-only (${problems.map((finding) => finding.subject).join(", ")}). DATA_MODE=synthetic starts anyway; personal mode would refuse. Run ${STORAGE_CHECK_COMMAND} for details.`;

/** Findings as text lines, for `doctor` and `lab:storage`. */
export const formatFindings = (findings: readonly StorageFinding[]): readonly string[] =>
  findings.map((finding) => {
    const mark =
      finding.status === "ok"
        ? "[ok]     "
        : finding.status === "not-ok"
          ? "[no]     "
          : "[unknown]";
    return `  ${mark} ${finding.subject}: ${finding.found}${finding.fix === null ? "" : `. Fix: ${finding.fix}`}`;
  });
