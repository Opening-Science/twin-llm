import { describe, expect, test } from "bun:test";

import {
  connectionFinding,
  defaultStateDir,
  filesFinding,
  formatFindings,
  isInside,
  isLoopbackHost,
  isOwnerOnly,
  listenFinding,
  loggingFinding,
  modeText,
  parseDatabaseConnection,
  passwordlessFinding,
  type PathFacts,
  pathFinding,
  refusalMessage,
  roleFinding,
  type ServerFacts,
  serverFactsFromRow,
  shellWord,
  shownPath,
  socketDirFinding,
  storageVerdict,
  syntheticWarning,
} from "./storage-hardening";

const HOME = "/home/synthetic-owner";
const CWD = "/work/twin-llm";
const STATE = `${HOME}/.local/share/twin-llm`;
const UID = 1000;

const found = (mode: number, directory = false, uid = UID): PathFacts => ({
  kind: "found",
  mode,
  uid,
  directory,
});

describe("defaultStateDir", () => {
  test("Linux uses XDG_DATA_HOME when absolute, else ~/.local/share", () => {
    expect(defaultStateDir({ platform: "linux", home: HOME })).toBe(STATE);
    expect(
      defaultStateDir({ platform: "linux", home: HOME, xdgDataHome: "/data/xdg/" }),
    ).toBe("/data/xdg/twin-llm");
    expect(
      defaultStateDir({ platform: "linux", home: HOME, xdgDataHome: "relative/xdg" }),
    ).toBe(STATE);
  });

  test("macOS uses Application Support", () => {
    expect(defaultStateDir({ platform: "darwin", home: "/Users/someone" })).toBe(
      "/Users/someone/Library/Application Support/TwinLLM",
    );
  });
});

describe("paths as shown", () => {
  test("relative inside the repository, $HOME under home, else as is", () => {
    const where = { cwd: CWD, home: HOME };
    expect(shownPath(`${CWD}/data/vitronic`, where)).toBe("data/vitronic");
    expect(shownPath(CWD, where)).toBe(".");
    expect(shownPath(STATE, where)).toBe("$HOME/.local/share/twin-llm");
    expect(shownPath("/srv/twin-llm", where)).toBe("/srv/twin-llm");
    expect(shownPath(`${HOME}-other/x`, where)).toBe(`${HOME}-other/x`);
  });

  test("isInside does not match a sibling with the same prefix", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b/", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
  });

  test("shell words keep $HOME expandable and quote the rest", () => {
    expect(shellWord("data/vitronic")).toBe("data/vitronic");
    expect(shellWord("$HOME/Library/Application Support/TwinLLM")).toBe(
      '"$HOME/Library/Application Support/TwinLLM"',
    );
    expect(shellWord('/odd "name"/$X')).toBe('"/odd \\"name\\"/\\$X"');
  });
});

describe("modes", () => {
  test("owner-only means no group or other bits", () => {
    expect(isOwnerOnly(0o700)).toBe(true);
    expect(isOwnerOnly(0o600)).toBe(true);
    expect(isOwnerOnly(0o400)).toBe(true);
    expect(isOwnerOnly(0o640)).toBe(false);
    expect(isOwnerOnly(0o701)).toBe(false);
    expect(modeText(0o40755)).toBe("755");
    expect(modeText(0o600)).toBe("600");
  });
});

describe("pathFinding", () => {
  const check = (facts: PathFacts, kind: "directory" | "file" = "directory") =>
    pathFinding({
      id: "state-dir",
      subject: "$TWINLLM_STATE_DIR",
      shown: "$HOME/.local/share/twin-llm",
      facts,
      ownUid: UID,
      kind,
      whenMissing: { status: "not-ok", found: "not created yet", fix: "mkdir" },
    });

  test.each([
    [found(0o700, true), "ok", "mode 700", null],
    [found(0o750, true), "not-ok", "mode 750", 'chmod 700 "$HOME/.local/share/twin-llm"'],
    [
      found(0o700, true, 0),
      "not-ok",
      "mode 700, owned by another user",
      'chown "$(id -u)" "$HOME/.local/share/twin-llm"',
    ],
    [
      found(0o600, false),
      "not-ok",
      "not a directory",
      'ls -ld "$HOME/.local/share/twin-llm"',
    ],
    [
      { kind: "unreadable" } as const,
      "unknown",
      "could not be checked",
      'ls -ld "$HOME/.local/share/twin-llm"',
    ],
    [{ kind: "missing" } as const, "not-ok", "not created yet", "mkdir"],
  ] as const)("%o", (facts, status, text, fix) => {
    const finding = check(facts);
    expect(finding.status).toBe(status);
    expect(finding.found).toBe(text);
    expect(finding.fix).toBe(fix);
  });

  test("a file wants 600", () => {
    const file = pathFinding({
      id: "env-file:.env.local",
      subject: ".env.local",
      shown: ".env.local",
      facts: found(0o644),
      ownUid: UID,
      kind: "file",
      whenMissing: { status: "ok", found: "not present", fix: null },
    });
    expect(file).toMatchObject({ status: "not-ok", fix: "chmod 600 .env.local" });
  });
});

describe("filesFinding", () => {
  const files = (list: PathFacts[] | null, truncated = false) =>
    filesFinding({
      id: "vitronic-files",
      subject: "Files in data/vitronic",
      shown: "data/vitronic",
      files: list,
      ownUid: UID,
      truncated,
    });

  test("all owner-only, none yet, wide, foreign, unreadable, truncated, unlisted", () => {
    expect(files([found(0o700, true), found(0o600)])).toMatchObject({
      status: "ok",
      found: "2 entries, all owner-only",
    });
    expect(files([])).toMatchObject({ status: "ok", found: "no files yet" });
    expect(files([found(0o644), found(0o600)])).toMatchObject({
      status: "not-ok",
      found: "1 entry open to group or others",
      fix: "chmod -R go-rwx data/vitronic",
    });
    expect(files([found(0o600, false, 0)])).toMatchObject({
      status: "not-ok",
      found: "1 entry owned by another user",
    });
    expect(files([{ kind: "unreadable" }])).toMatchObject({ status: "unknown" });
    expect(files([found(0o600)], true)).toMatchObject({ status: "unknown" });
    expect(files(null)).toMatchObject({
      status: "unknown",
      found: "could not be listed",
    });
  });
});

describe("parseDatabaseConnection", () => {
  test.each([
    ["postgresql://twinllm:pw@127.0.0.1:5432/twin_llm", true],
    ["postgresql://twinllm:pw@127.8.9.10/twin_llm", true],
    ["postgresql://twinllm:pw@localhost/twin_llm", true],
    ["postgresql://twinllm:pw@[::1]:5432/twin_llm", true],
    ["postgres://twinllm:pw@LOCALHOST/twin_llm", true],
    ["postgresql://twinllm:pw@localhost.example.com/twin_llm", false],
    ["postgresql://twinllm:pw@127.0.0.1.nip.io/twin_llm", false],
    ["postgresql://twinllm:pw@10.0.0.4/twin_llm", false],
    ["postgresql://twinllm:pw@db.example.org/twin_llm", false],
  ])("%s is loopback: %p", (url, loopback) => {
    const connection = parseDatabaseConnection(url);
    expect(connection.kind).toBe("tcp");
    expect(connection.kind === "tcp" && connection.loopback).toBe(loopback);
  });

  test("socket folders: host parameter, %2F host and an empty host", () => {
    expect(
      parseDatabaseConnection(
        "postgresql://twinllm:pw@localhost/twin_llm?host=%2Fhome%2Fa%20b%2Fpg-socket%2F",
      ),
    ).toEqual({
      kind: "socket",
      socketDir: "/home/a b/pg-socket",
      port: 5432,
      user: "twinllm",
      hasPassword: true,
      database: "twin_llm",
    });
    expect(
      parseDatabaseConnection("postgresql://twinllm@/twin_llm?host=/s&port=6543"),
    ).toEqual({
      kind: "socket",
      socketDir: "/s",
      port: 6543,
      user: "twinllm",
      hasPassword: false,
      database: "twin_llm",
    });
    expect(
      parseDatabaseConnection("postgresql://u:p@%2Fvar%2Frun%2Fpg/db"),
    ).toMatchObject({
      kind: "socket",
      socketDir: "/var/run/pg",
    });
  });

  test("a host parameter wins over the URL's host", () => {
    expect(
      parseDatabaseConnection("postgresql://u:p@127.0.0.1/db?host=db.example.org"),
    ).toMatchObject({ kind: "tcp", host: "db.example.org", loopback: false });
  });

  test("password presence, never its value", () => {
    const withPassword = parseDatabaseConnection("postgresql://u:secret@127.0.0.1/db");
    expect(withPassword).toMatchObject({ hasPassword: true });
    expect(JSON.stringify(withPassword)).not.toContain("secret");
    expect(parseDatabaseConnection("postgresql://u@127.0.0.1/db")).toMatchObject({
      hasPassword: false,
    });
    expect(
      parseDatabaseConnection("postgresql://u@127.0.0.1/db?password=secret"),
    ).toMatchObject({ hasPassword: true });
  });

  test("refuses what it cannot read", () => {
    expect(parseDatabaseConnection("mysql://u:p@127.0.0.1/db").kind).toBe("invalid");
    expect(parseDatabaseConnection("postgresql://u:p@/db").kind).toBe("invalid");
    expect(parseDatabaseConnection("postgresql://u:p@a,b/db").kind).toBe("invalid");
    expect(parseDatabaseConnection("postgresql://u:p@h:99999/db").kind).toBe("invalid");
  });

  test("loopback hosts exactly", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("127.0.0.256")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });
});

describe("connectionFinding", () => {
  const where = { stateDir: STATE, stateShown: "$HOME/.local/share/twin-llm" };
  const check = (url: string) => connectionFinding(parseDatabaseConnection(url), where);

  test("socket in the state folder, or loopback with a password", () => {
    expect(
      check(`postgresql://twinllm:pw@localhost/twin_llm?host=${STATE}/pg-socket`).status,
    ).toBe("ok");
    expect(check("postgresql://twinllm:pw@127.0.0.1/twin_llm").status).toBe("ok");
  });

  test("socket elsewhere, no password, another host, unreadable", () => {
    expect(
      check("postgresql://twinllm:pw@localhost/db?host=/var/run/postgresql"),
    ).toMatchObject({
      status: "not-ok",
      found: "socket outside $TWINLLM_STATE_DIR",
    });
    expect(check("postgresql://twinllm@127.0.0.1/db")).toMatchObject({
      status: "not-ok",
      found: "loopback TCP without a password",
    });
    expect(check("postgresql://twinllm:pw@db.example.org/db")).toMatchObject({
      status: "not-ok",
      found: "TCP to a host that is not loopback",
    });
    expect(check("postgresql://u:p@/db").status).toBe("not-ok");
  });

  test("the socket folder must be owner-only too", () => {
    expect(
      socketDirFinding({ shown: "$HOME/x", facts: found(0o755, true), ownUid: UID }),
    ).toMatchObject({ status: "not-ok", fix: 'chmod 700 "$HOME/x"' });
    expect(
      socketDirFinding({ shown: "$HOME/x", facts: { kind: "missing" }, ownUid: UID }),
    ).toMatchObject({ status: "not-ok" });
  });
});

describe("what the server says", () => {
  const facts = (overrides: Partial<ServerFacts> = {}): ServerFacts => ({
    superuser: false,
    listenAddresses: "",
    logStatement: "none",
    logMinDurationStatement: "-1",
    ...overrides,
  });
  const socket = parseDatabaseConnection(`postgresql://t:p@localhost/d?host=${STATE}/s`);
  const tcp = parseDatabaseConnection("postgresql://t:p@127.0.0.1/d");

  test("reads a row and refuses a wrong shape", () => {
    expect(
      serverFactsFromRow({
        superuser: true,
        listen_addresses: "localhost",
        log_statement: "all",
        log_min_duration_statement: "-1",
      }),
    ).toEqual({
      superuser: true,
      listenAddresses: "localhost",
      logStatement: "all",
      logMinDurationStatement: "-1",
    });
    expect(serverFactsFromRow({ superuser: "f", listen_addresses: "" })).toBeNull();
    expect(serverFactsFromRow(undefined)).toBeNull();
  });

  test("a superuser is refused; an unreadable role is unknown", () => {
    expect(roleFinding(facts()).status).toBe("ok");
    expect(roleFinding(facts({ superuser: true }))).toMatchObject({
      status: "not-ok",
      found: "superuser",
    });
    expect(roleFinding(null).status).toBe("unknown");
  });

  test("listen addresses: none for a socket, loopback for TCP", () => {
    expect(listenFinding(socket, facts()).status).toBe("ok");
    expect(listenFinding(socket, facts({ listenAddresses: "localhost" })).status).toBe(
      "not-ok",
    );
    expect(listenFinding(tcp, facts({ listenAddresses: "localhost, ::1" })).status).toBe(
      "ok",
    );
    expect(listenFinding(tcp, facts({ listenAddresses: "*" })).status).toBe("not-ok");
    expect(listenFinding(tcp, facts({ listenAddresses: "0.0.0.0" })).status).toBe(
      "not-ok",
    );
    expect(listenFinding(tcp, null).status).toBe("unknown");
  });

  test("statement logging", () => {
    expect(loggingFinding(facts()).status).toBe("ok");
    expect(loggingFinding(facts({ logStatement: "ddl" })).status).toBe("ok");
    expect(
      loggingFinding(facts({ logStatement: "all", logMinDurationStatement: "0" })),
    ).toMatchObject({
      status: "not-ok",
      found: "log_statement all, log_min_duration_statement on",
    });
    expect(loggingFinding(facts({ logStatement: null })).status).toBe("unknown");
  });

  test("a sign-in without a password", () => {
    expect(passwordlessFinding(false).status).toBe("ok");
    expect(passwordlessFinding(true)).toMatchObject({
      status: "not-ok",
      found: "accepted (trust)",
    });
    expect(passwordlessFinding(null).status).toBe("unknown");
  });
});

describe("verdict and messages", () => {
  const bad = pathFinding({
    id: "env-file:.env.local",
    subject: ".env.local",
    shown: ".env.local",
    facts: found(0o644),
    ownUid: UID,
    kind: "file",
    whenMissing: { status: "ok", found: "", fix: null },
  });
  const unknown = roleFinding(null);
  const good = roleFinding({ superuser: false, listenAddresses: "" });

  test("personal mode refuses on anything not OK, unknown included", () => {
    expect(storageVerdict("personal", [good]).refuse).toBe(false);
    expect(storageVerdict("personal", [good, unknown]).refuse).toBe(true);
    expect(storageVerdict("personal", [bad]).problems).toEqual([bad]);
    expect(storageVerdict("synthetic", [bad, unknown])).toEqual({
      refuse: false,
      problems: [bad, unknown],
    });
  });

  test("the refusal names each problem and its fix, and no secret or home path", () => {
    const connection = connectionFinding(
      parseDatabaseConnection("postgresql://postgres:hunter2@db.example.org/x"),
      { stateDir: STATE, stateShown: "$HOME/.local/share/twin-llm" },
    );
    const message = refusalMessage([bad, connection]);
    expect(message).toContain("DATA_MODE=personal");
    expect(message).toContain(".env.local: mode 644; needs mode 600 or narrower");
    expect(message).toContain("Fix: chmod 600 .env.local");
    expect(message).toContain("bun run setup:local -- --owner-cluster");
    expect(message).toContain("bun run lab:storage");
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("db.example.org");
    expect(message).not.toContain(HOME);
  });

  test("the synthetic warning is one line", () => {
    const line = syntheticWarning([bad, unknown]);
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain(
      "2 storage checks are not owner-only (.env.local, Database role)",
    );
  });

  test("text lines for doctor", () => {
    expect(formatFindings([good, bad])).toEqual([
      "  [ok]      Database role: not a superuser",
      "  [no]      .env.local: mode 644. Fix: chmod 600 .env.local",
    ]);
  });
});
